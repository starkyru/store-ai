import type { AIStore, AIFullState, StoreAdapterResult } from '@store-ai/core';
import { Store } from '@tanstack/store';

export function toTanstack<T = unknown>(
  aiStore: AIStore<T>,
): StoreAdapterResult<Store<AIFullState<T>>> {
  if (!aiStore || typeof aiStore.get !== 'function' || typeof aiStore.subscribe !== 'function') {
    throw new TypeError('toTanstack() requires a valid AIStore instance');
  }

  let destroyed = false;
  const store = new Store<AIFullState<T>>(aiStore.get());
  const unsub = aiStore.subscribe((state) => {
    if (destroyed) return;
    store.setState(() => state);
  });

  return {
    store,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsub();
    },
  };
}
