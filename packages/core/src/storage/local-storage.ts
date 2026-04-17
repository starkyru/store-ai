import type { SerializedChat, StorageAdapter } from '../types.js';

/**
 * Minimal runtime check that a parsed value has the shape of {@link SerializedChat}.
 * This guards against tampered / malicious data written to localStorage by
 * other same-origin scripts or browser extensions.
 */
function isSerializedChat(v: unknown): v is SerializedChat {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['id'] === 'string' &&
    Array.isArray(obj['messages']) &&
    typeof obj['createdAt'] === 'string' &&
    typeof obj['updatedAt'] === 'string'
  );
}

/**
 * Browser `localStorage`-backed storage adapter with key prefixing.
 *
 * @param prefix - Key prefix for all entries. Defaults to `"store-ai"`.
 *                 Keys are stored as `"<prefix>:<chatId>"`.
 *
 * Silently no-ops when `localStorage` is unavailable (SSR, Web Workers).
 * Validates data shape on read to guard against tampered entries.
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
    async get(key: string): Promise<SerializedChat | null> {
      if (!isAvailable()) return null;
      try {
        const raw = localStorage.getItem(prefixedKey(key));
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        // Validate shape before trusting the data
        if (!isSerializedChat(parsed)) return null;
        return parsed;
      } catch {
        return null;
      }
    },

    async set(key: string, value: SerializedChat): Promise<void> {
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
