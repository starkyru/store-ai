import type { StorageAdapter } from '../types.js';

/**
 * Browser `localStorage`-backed storage adapter with key prefixing.
 *
 * @param prefix - Key prefix for all entries. Defaults to `"store-ai"`.
 *                 Keys are stored as `"<prefix>:<chatId>"`.
 *
 * Silently no-ops when `localStorage` is unavailable (SSR, Web Workers).
 */
export function localStorageAdapter(prefix?: string): StorageAdapter {
  const pfx = prefix ?? 'store-ai';

  function isAvailable(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  function prefixedKey(key: string): string {
    return `${pfx}:${key}`;
  }

  return {
    async get(key: string): Promise<unknown | null> {
      if (!isAvailable()) return null;
      try {
        const raw = localStorage.getItem(prefixedKey(key));
        if (raw === null) return null;
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      if (!isAvailable()) return;
      try {
        localStorage.setItem(prefixedKey(key), JSON.stringify(value));
      } catch {
        // Silently ignore (e.g. quota exceeded)
      }
    },

    async delete(key: string): Promise<void> {
      if (!isAvailable()) return;
      try {
        localStorage.removeItem(prefixedKey(key));
      } catch {
        // Silently ignore
      }
    },

    async list(): Promise<string[]> {
      if (!isAvailable()) return [];
      try {
        const keys: string[] = [];
        const pfxColon = `${pfx}:`;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null && k.startsWith(pfxColon)) {
            keys.push(k.slice(pfxColon.length));
          }
        }
        return keys;
      } catch {
        return [];
      }
    },
  };
}
