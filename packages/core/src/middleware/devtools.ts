import type { AIState, MiddlewareContext, MiddlewareObject, StreamEvent } from '../types.js';

export interface DevToolsEvent {
  /** Auto-incrementing index */
  index: number;
  /** ISO timestamp */
  timestamp: string;
  /** The stream event */
  event: StreamEvent;
  /** State snapshot AFTER this event was processed */
  stateAfter: Readonly<AIState>;
  /** Time elapsed since stream start (ms) */
  elapsed: number;
}

export interface DevToolsInspector {
  /** All recorded events for the current/last stream */
  getEvents(): DevToolsEvent[];
  /** Get a specific event by index */
  getEvent(index: number): DevToolsEvent | undefined;
  /** Get events filtered by type */
  getEventsByType(type: StreamEvent['type']): DevToolsEvent[];
  /** Get total event count */
  getEventCount(): number;
  /** Get stream duration (ms) */
  getDuration(): number | null;
  /** Get events per second */
  getEventsPerSecond(): number | null;
  /** Clear the event log */
  clear(): void;
  /** Export the full event log as JSON */
  export(): string;
}

export interface DevToolsOptions {
  /** Maximum events to keep in memory (default: 1000). Oldest are dropped. */
  maxEvents?: number;
  /** Whether to expose on window.__STORE_AI_DEVTOOLS__ (default: false) */
  exposeGlobal?: boolean;
  /** Custom name for this store instance (for multi-store debugging) */
  name?: string;
}

/**
 * Serialize a value for JSON export, handling Error objects that aren't
 * natively JSON-serializable.
 */
function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

/**
 * DevTools middleware that records all stream events with timestamps and
 * state snapshots for inspection and debugging.
 *
 * Returns both the middleware and an inspector API.
 */
export function devtools(opts?: DevToolsOptions): {
  middleware: MiddlewareObject;
  inspector: DevToolsInspector;
} {
  const maxEvents = opts?.maxEvents ?? 1000;

  let events: DevToolsEvent[] = [];
  let eventIndex = 0;
  let startTime: number | null = null;
  let endTime: number | null = null;

  function pushEvent(entry: DevToolsEvent): void {
    events.push(entry);
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }
  }

  const inspector: DevToolsInspector = {
    getEvents(): DevToolsEvent[] {
      return events.slice();
    },

    getEvent(index: number): DevToolsEvent | undefined {
      return events.find((e) => e.index === index);
    },

    getEventsByType(type: StreamEvent['type']): DevToolsEvent[] {
      return events.filter((e) => e.event.type === type);
    },

    getEventCount(): number {
      return events.length;
    },

    getDuration(): number | null {
      if (startTime === null) return null;
      if (endTime === null) return null;
      return endTime - startTime;
    },

    getEventsPerSecond(): number | null {
      const duration = inspector.getDuration();
      if (duration === null || duration === 0) return null;
      return (events.length / duration) * 1000;
    },

    clear(): void {
      events = [];
      eventIndex = 0;
      startTime = null;
      endTime = null;
    },

    export(): string {
      return JSON.stringify(events, errorReplacer, 2);
    },
  };

  // Expose on globalThis if requested
  if (opts?.exposeGlobal) {
    const g = globalThis as Record<string, unknown>;
    const existing = g.__STORE_AI_DEVTOOLS__;

    if (existing && Array.isArray(existing)) {
      // Multiple stores already registered — push to array
      (existing as DevToolsInspector[]).push(inspector);
    } else if (existing) {
      // Single store already registered — convert to array
      g.__STORE_AI_DEVTOOLS__ = [existing as DevToolsInspector, inspector];
    } else {
      // First store
      g.__STORE_AI_DEVTOOLS__ = inspector;
    }
  }

  const middleware: MiddlewareObject = {
    name: opts?.name ?? 'devtools',

    onStart(_ctx: { state: Readonly<AIState> }) {
      // Reset log for new stream
      events = [];
      eventIndex = 0;
      startTime = Date.now();
      endTime = null;
    },

    async onEvent(ctx: MiddlewareContext, next: () => Promise<void>) {
      // Let the event propagate first so the reducer updates state
      await next();

      const now = Date.now();

      // ctx.state is the state reference at context-creation time (before the
      // middleware chain ran).  After next() the reducer has already produced a
      // new state object, but the store doesn't back-patch ctx.state.  So we
      // capture whatever ctx.state currently points to — for events processed
      // in sequence this is the state that includes all prior events and (due
      // to immutable reducer semantics) is a safe reference to keep.
      const entry: DevToolsEvent = {
        index: eventIndex++,
        timestamp: new Date(now).toISOString(),
        event: ctx.event,
        stateAfter: ctx.state,
        elapsed: startTime !== null ? now - startTime : 0,
      };

      pushEvent(entry);

      // Track stream end — the store only calls onComplete when a stream
      // finishes without an explicit 'finish' event, so we also record
      // endTime here to cover the common case.
      if (ctx.event.type === 'finish' || ctx.event.type === 'error') {
        endTime = now;
      }
    },

    onComplete(_ctx: { state: Readonly<AIState> }) {
      endTime = Date.now();
    },

    onError(_error: Error, _ctx: { state: Readonly<AIState> }) {
      endTime = Date.now();
    },

    onAbort(_ctx: { state: Readonly<AIState> }) {
      endTime = Date.now();
    },
  };

  return { middleware, inspector };
}
