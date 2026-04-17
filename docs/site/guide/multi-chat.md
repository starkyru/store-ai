# Multi-Chat

The `ChatManager` coordinates multiple independent `AIStore` instances, making it easy to build multi-conversation interfaces.

## Basic Usage

```typescript
import { createChatManager, anthropic } from '@store-ai/core';

const manager = createChatManager({
  provider: anthropic(),
});

// Create chats
const chat1 = manager.create('chat-1');
const chat2 = manager.create('chat-2');

// Switch active chat
manager.setActive('chat-1');
console.log(manager.active); // AIStore for chat-1

// List all chats
const chats = manager.list();
// [{ id: 'chat-1', title: null, messageCount: 0, ... }, ...]

// Delete a chat
manager.delete('chat-2');
```

## Chat Manager API

```typescript
interface ChatManager {
  create(id?: string, opts?: ChatOptions): AIStore;
  get(id: string): AIStore | undefined;
  delete(id: string): void;
  list(): ChatInfo[];

  activeId: string | null;
  active: AIStore | null;
  setActive(id: string): void;

  subscribe(listener: (chats: ChatInfo[]) => void): () => void;
  onAny(event: string, listener: (chatId: string, state: AIState) => void): () => void;

  destroy(): void;
}
```

Each chat is a fully independent `AIStore` with its own middleware stack, stream, and state. The `ChatManager` is a lightweight registry with its own `subscribe` contract.

## With Persistence

Combine with the `persist` middleware to save each conversation independently:

```typescript
import {
  createChatManager,
  persist,
  localStorageAdapter,
  listChats,
  restoreChat,
} from '@store-ai/core';

const storage = localStorageAdapter('my-app');

const manager = createChatManager({
  provider: anthropic(),
});

// Restore saved chats on startup
const savedIds = await listChats(storage);
for (const id of savedIds) {
  const chat = manager.create(id);
  chat.use(persist(storage, id));
  const saved = await restoreChat(storage, id);
  if (saved) {
    chat.setMessages(saved.messages);
  }
}
```

## Cleanup

Call `manager.destroy()` to clean up all chats, abort active streams, and release resources.
