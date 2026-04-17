import type { StorageAdapter } from '../types.js';

/**
 * In-memory storage adapter backed by a `Map`. Useful for testing and
 * short-lived sessions. Data does not survive page reloads.
 */
export function memoryStorage(): StorageAdapter {
  const store = new Map<string, unknown>();

  return {
    async get(key: string): Promise<unknown | null> {
      return store.get(key) ?? null;
    },

    async set(key: string, value: unknown): Promise<void> {
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
