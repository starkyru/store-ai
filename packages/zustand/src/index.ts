import type { AIStore, AIFullState, StoreAdapterResult } from '@store-ai/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

export function toZustand<T = unknown>(
  aiStore: AIStore<T>,
): StoreAdapterResult<StoreApi<AIFullState<T>>> {
  if (!aiStore || typeof aiStore.get !== 'function' || typeof aiStore.subscribe !== 'function') {
    throw new TypeError('toZustand() requires a valid AIStore instance');
  }

  let destroyed = false;
  const zStore = createStore<AIFullState<T>>(() => aiStore.get());
  const unsub = aiStore.subscribe((state) => {
    if (destroyed) return;
    zStore.setState(state, true);
  });

  return {
    store: zStore,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsub();
    },
  };
}
