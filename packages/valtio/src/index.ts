import type { AIStore, AIFullState, StoreAdapterResult } from '@store-ai/core';
import { proxy } from 'valtio/vanilla';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function toValtio<T = unknown>(aiStore: AIStore<T>): StoreAdapterResult<AIFullState<T>> {
  if (!aiStore || typeof aiStore.get !== 'function' || typeof aiStore.subscribe !== 'function') {
    throw new TypeError('toValtio() requires a valid AIStore instance');
  }

  let destroyed = false;
  const state = proxy<AIFullState<T>>(aiStore.get());

  // Use a typed record view for property assignment to avoid `as any`
  // while still allowing per-key writes that valtio's proxy can track.
  const stateRecord = state as unknown as Record<string, unknown>;
  const unsub = aiStore.subscribe((next) => {
    if (destroyed) return;
    const nextRecord = next as unknown as Record<string, unknown>;
    // Update each key individually to trigger valtio's proxy tracking.
    // Guard against prototype pollution by skipping dangerous key names
    // and non-own properties.
    for (const key of Object.keys(nextRecord)) {
      if (UNSAFE_KEYS.has(key)) continue;
      if (!Object.hasOwn(nextRecord, key)) continue;
      stateRecord[key] = nextRecord[key];
    }
    // Remove stale keys that no longer exist in the new state
    // (e.g., after a reset produces a fresh state shape)
    for (const key of Object.keys(stateRecord)) {
      if (!Object.hasOwn(nextRecord, key)) {
        delete stateRecord[key];
      }
    }
  });

  return {
    store: state,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsub();
    },
  };
}
