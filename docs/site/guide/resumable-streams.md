# Resumable Streams

The `resumable` middleware persists stream events to storage, enabling recovery after connection drops or page reloads.

## How It Works

1. As events arrive, the middleware buffers them in memory
2. Every 10 events (and on stream end), it flushes to storage as a checkpoint
3. On disconnect, the checkpoint preserves all events received so far
4. On reconnect, replay the checkpoint events and continue from where you left off

## Setup

```typescript
import { createAIStore, resumable, memoryStorage } from '@store-ai/core';

const storage = memoryStorage(); // or localStorageAdapter, indexedDBAdapter

const store = createAIStore({
  middleware: [
    resumable({
      storage,
      streamId: 'chat-1-req-42', // unique per request
    }),
  ],
});
```

## Restoring After Disconnect

```typescript
import { getStreamCheckpoint } from '@store-ai/core';

const checkpoint = await getStreamCheckpoint(storage, 'chat-1-req-42');

if (checkpoint && !checkpoint.completed) {
  // Stream was interrupted — replay saved events
  async function* replayEvents() {
    for (const event of checkpoint.events) {
      yield event;
    }
    // Optionally: reconnect to server for remaining events
  }
  store.submit({ events: replayEvents() });
}
```

## Checkpoint Shape

```typescript
interface StreamCheckpoint {
  streamId: string;
  events: StreamEvent[]; // all events received
  completed: boolean; // true if stream finished normally
  lastEventAt: string; // ISO timestamp
}
```

## Cleanup

```typescript
import { deleteStreamCheckpoint } from '@store-ai/core';

// Remove a checkpoint after successful completion
await deleteStreamCheckpoint(storage, 'chat-1-req-42');
```

## Storage Adapters

Works with any `StorageAdapter`:

```typescript
import { localStorageAdapter, indexedDBAdapter } from '@store-ai/core';

// Survives page reloads
resumable({ storage: localStorageAdapter('my-app'), streamId: '...' });

// Larger storage capacity
resumable({ storage: indexedDBAdapter('my-app'), streamId: '...' });
```
