# Persistence

store-ai persists conversations through the `persist` middleware and pluggable storage adapters. Persistence is opt-in -- nothing is saved unless you add the middleware.

## Basic Usage

```typescript
import {
  createAIStore,
  persist,
  localStorageAdapter,
  restoreChat,
  listChats,
  deleteChat,
} from '@store-ai/core';

const storage = localStorageAdapter('my-app');

const store = createAIStore({
  middleware: [persist(storage, 'chat-1')],
});

// Restore a previous conversation on page load
const saved = await restoreChat(storage, 'chat-1');
if (saved) {
  store.setMessages(saved.messages);
}
```

## Storage Adapters

| Adapter                        | Description                            |
| ------------------------------ | -------------------------------------- |
| `memoryStorage()`              | In-memory `Map` (useful for testing)   |
| `localStorageAdapter(prefix?)` | Browser `localStorage` with key prefix |
| `indexedDBAdapter(dbName?)`    | Browser `IndexedDB`                    |

All storage adapters implement the `StorageAdapter` interface:

```typescript
interface StorageAdapter {
  get(key: string): Promise<SerializedChat | null>;
  set(key: string, value: SerializedChat): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}
```

You can implement this interface to persist to any backend (database, cloud storage, etc.).

## Managing Chats

```typescript
// List all saved chat IDs
const chatIds = await listChats(storage);

// Delete a specific chat
await deleteChat(storage, 'old-chat');
```

## How It Works

The `persist` middleware saves the full message history to the storage adapter whenever a stream completes. On restore, you get a `SerializedChat` object with `messages`, `metadata`, `createdAt`, and `updatedAt`.

Storage adapter failures do not crash the stream -- they are silently caught so persistence issues never interrupt the user experience.
