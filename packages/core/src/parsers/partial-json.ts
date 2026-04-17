import type { DeepPartial } from '../types.js';

export interface PartialJSONParser<T = unknown> {
  /** Feed a new chunk of JSON text. Returns the best partial parse, or null if nothing parseable yet. */
  push(chunk: string): DeepPartial<T> | null;
  /** Get the last successful partial parse */
  getPartial(): DeepPartial<T> | null;
  /** Get the final complete parse (only valid after stream ends) */
  getFinal(): T | null;
  /** Reset parser state */
  reset(): void;
}

/** Maximum accumulated size (10 MB) to prevent memory exhaustion. */
const MAX_ACCUMULATED_SIZE = 10 * 1024 * 1024;

const enum Ctx {
  Object = 1,
  Array = 2,
  String = 3,
}

/** Keys that must never appear at the top level of parsed JSON to prevent prototype pollution. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strips unsafe keys (`__proto__`, `constructor`, `prototype`) from
 * a parsed JSON value to prevent prototype-pollution attacks. Returns a new
 * object (shallow clone per level) when removals are needed; returns the
 * original reference when no unsafe keys are found for zero-overhead in the
 * common case.
 */
function sanitize<R>(value: R): R {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    // Arrays: recurse into each element.  Only allocate a new array if an
    // element was changed so the common case is O(1) allocation.
    let changed = false;
    const out = value.map((el) => {
      const clean = sanitize(el);
      if (clean !== el) changed = true;
      return clean;
    });
    return (changed ? out : value) as R;
  }
  // Plain objects
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (UNSAFE_KEYS.has(key)) {
      changed = true;
      continue; // drop the key entirely
    }
    const clean = sanitize((value as Record<string, unknown>)[key]);
    if (clean !== (value as Record<string, unknown>)[key]) changed = true;
    out[key] = clean;
  }
  return (changed ? out : value) as R;
}

export function createPartialJSONParser<T = unknown>(): PartialJSONParser<T> {
  let accumulated = '';
  let scanOffset = 0; // tracks how far we have already scanned for incremental stack updates
  let stack: Ctx[] = [];
  let inString = false;
  let escaped = false;
  let lastPartial: DeepPartial<T> | null = null;
  let finalResult: T | null = null;

  function updateStack(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inString) {
        if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
          // Pop the String context
          if (stack.length > 0 && stack[stack.length - 1] === Ctx.String) {
            stack.pop();
          }
        }
        continue;
      }

      // Not inside a string
      switch (ch) {
        case '"':
          inString = true;
          stack.push(Ctx.String);
          break;
        case '{':
          stack.push(Ctx.Object);
          break;
        case '}':
          // Pop back to the matching Object context
          for (let j = stack.length - 1; j >= 0; j--) {
            if (stack[j] === Ctx.Object) {
              stack.length = j;
              break;
            }
          }
          break;
        case '[':
          stack.push(Ctx.Array);
          break;
        case ']':
          // Pop back to the matching Array context
          for (let j = stack.length - 1; j >= 0; j--) {
            if (stack[j] === Ctx.Array) {
              stack.length = j;
              break;
            }
          }
          break;
      }
    }
  }

  function repair(text: string): string {
    // Trim trailing whitespace from the text for repair
    let repaired = text;

    // Close open contexts in reverse stack order
    const closers: string[] = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      switch (stack[i]) {
        case Ctx.String:
          closers.push('"');
          break;
        case Ctx.Object:
          closers.push('}');
          break;
        case Ctx.Array:
          closers.push(']');
          break;
      }
    }

    if (closers.length === 0) return repaired;

    // Before appending closers, clean up trailing syntax issues:
    // - trailing commas: [1, 2, ] or {"a": 1, }
    // - trailing colons: {"key": }
    // - incomplete key without value: {"key"  (no colon yet)
    // Only do this if we're NOT closing a string first
    if (closers[0] !== '"') {
      repaired = repaired.replace(/,\s*$/, '');
      // Remove trailing colon (incomplete key-value)
      repaired = repaired.replace(/:\s*$/, ': null');
    }

    return repaired + closers.join('');
  }

  function tryParse(text: string): DeepPartial<T> | null {
    try {
      return JSON.parse(text) as DeepPartial<T>;
    } catch {
      return null;
    }
  }

  return {
    push(chunk: string): DeepPartial<T> | null {
      if (accumulated.length + chunk.length > MAX_ACCUMULATED_SIZE) {
        // Cap at maximum size -- drop the chunk to prevent memory exhaustion
        return lastPartial;
      }

      accumulated += chunk;

      // Before any '{' or '[' has appeared, nothing is parseable
      const firstBrace = accumulated.indexOf('{');
      const firstBracket = accumulated.indexOf('[');
      if (firstBrace === -1 && firstBracket === -1) {
        return null;
      }

      const startIdx = Math.min(
        firstBrace === -1 ? Infinity : firstBrace,
        firstBracket === -1 ? Infinity : firstBracket,
      );

      // Incremental scanning: only process characters we haven't seen yet.
      // On the first call, scanOffset is 0 so we scan from the first structural
      // character. On subsequent calls we continue from where we left off.
      // This keeps the total work across all push() calls O(N) instead of O(N^2).
      const effectiveStart = Math.max(startIdx, scanOffset);
      if (effectiveStart < accumulated.length) {
        updateStack(accumulated.slice(effectiveStart));
        scanOffset = accumulated.length;
      }

      const repaired = repair(accumulated.slice(startIdx));
      const parsed = tryParse(repaired);
      if (parsed !== null) {
        lastPartial = sanitize(parsed);
      }
      return lastPartial;
    },

    getPartial(): DeepPartial<T> | null {
      return lastPartial;
    },

    getFinal(): T | null {
      if (finalResult !== null) return finalResult;
      // Try to parse the full accumulated text as-is (no repair)
      try {
        // Find the first structural char
        const firstBrace = accumulated.indexOf('{');
        const firstBracket = accumulated.indexOf('[');
        if (firstBrace === -1 && firstBracket === -1) return null;
        const startIdx = Math.min(
          firstBrace === -1 ? Infinity : firstBrace,
          firstBracket === -1 ? Infinity : firstBracket,
        );
        finalResult = sanitize(JSON.parse(accumulated.slice(startIdx)) as T);
        return finalResult;
      } catch {
        // If the full text doesn't parse, return the last partial as a best effort
        return lastPartial as T | null;
      }
    },

    reset(): void {
      accumulated = '';
      scanOffset = 0;
      stack = [];
      inString = false;
      escaped = false;
      lastPartial = null;
      finalResult = null;
    },
  };
}
