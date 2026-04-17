import type { SerializedChat, StorageAdapter } from '../types.js';

export function memoryStorage(): StorageAdapter {
  const store = new Map<string, SerializedChat>();

  return {
    async get(key: string): Promise<SerializedChat | null> {
      return store.get(key) ?? null;
    },

    async set(key: string, value: SerializedChat): Promise<void> {
      store.set(key, value);
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async list(): Promise<string[]> {
      return [...store.keys()];
    },
  };
}
