import type { SerializedChat, StorageAdapter } from '../types.js';

/**
 * IndexedDB-backed storage adapter for persistent chat storage.
 *
 * @param dbName - Database name. Defaults to `"store-ai"`.
 *                 Uses an object store called `"chats"` with `id` as key path.
 *
 * Silently no-ops when IndexedDB is unavailable (SSR, some privacy modes).
 */
export function indexedDBAdapter(dbName?: string): StorageAdapter {
  const name = dbName ?? 'store-ai';
  const storeName = 'chats';

  function isAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined';
    } catch {
      return false;
    }
  }

  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return openDB().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const objStore = tx.objectStore(storeName);
          const request = fn(objStore);

          request.onsuccess = () => {
            resolve(request.result);
            db.close();
          };
          request.onerror = () => {
            reject(request.error);
            db.close();
          };
        }),
    );
  }

  return {
    async get(key: string): Promise<SerializedChat | null> {
      if (!isAvailable()) return null;
      try {
        const result = await withStore<SerializedChat | undefined>('readonly', (store) =>
          store.get(key),
        );
        return result ?? null;
      } catch {
        return null;
      }
    },

    async set(_key: string, value: SerializedChat): Promise<void> {
      if (!isAvailable()) return;
      try {
        await withStore('readwrite', (store) => store.put(value));
      } catch {
        // Silently ignore
      }
    },

    async delete(key: string): Promise<void> {
      if (!isAvailable()) return;
      try {
        await withStore('readwrite', (store) => store.delete(key));
      } catch {
        // Silently ignore
      }
    },

    async list(): Promise<string[]> {
      if (!isAvailable()) return [];
      try {
        const result = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
        return result.map(String);
      } catch {
        return [];
      }
    },
  };
}
