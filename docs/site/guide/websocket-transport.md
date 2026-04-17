# WebSocket Transport

store-ai supports WebSocket connections as an alternative to SSE for bidirectional AI streaming.

## Basic Usage

```typescript
import { createAIStore, createWebSocketTransport } from '@store-ai/core';

const store = createAIStore();

const events = createWebSocketTransport({
  url: 'wss://api.example.com/chat',
  format: 'json',
  onOpen: (ws) => {
    ws.send(JSON.stringify({ prompt: 'Hello', model: 'claude-3' }));
  },
});

store.submit({ events });
```

## Formats

### JSON Format

Each WebSocket message is parsed as a `StreamEvent` JSON object:

```typescript
createWebSocketTransport({
  url: 'wss://...',
  format: 'json', // { type: 'text-delta', text: '...' }
});
```

### Text Format

Each WebSocket message is wrapped as a `text-delta` event:

```typescript
createWebSocketTransport({
  url: 'wss://...',
  format: 'text', // raw text → { type: 'text-delta', text: message }
});
```

### Custom Transform

Full control over message parsing:

```typescript
createWebSocketTransport({
  url: 'wss://...',
  transformMessage: (data) => {
    const parsed = JSON.parse(data as string);
    if (parsed.type === 'token') {
      return { type: 'text-delta', text: parsed.content };
    }
    return null; // skip this message
  },
});
```

## Convenience: submitViaWebSocket

Combines connection + submit in one call:

```typescript
import { submitViaWebSocket } from '@store-ai/core';

const handle = submitViaWebSocket(store, {
  url: 'wss://api.example.com/chat',
  format: 'json',
  message: 'Hello', // sent via onOpen
});

// Abort closes the WebSocket
handle.abort();
```

## Abort Handling

Aborting the store or the returned `StreamHandle` automatically closes the WebSocket connection:

```typescript
const handle = store.submit({ events });
// Later...
store.abort(); // closes WebSocket, ends event stream
```
