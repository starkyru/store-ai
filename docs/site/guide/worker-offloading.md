# Worker Offloading

Move stream parsing to a Web Worker to keep the main thread free for rendering.

## Why

SSE parsing, JSON parsing, and provider normalization are CPU work. On fast streams (thousands of tokens/second), this can cause frame drops. Worker offloading moves all parsing to a background thread and sends only the final `StreamEvent` objects to the main thread.

## Setup

### 1. Create a Worker File

```typescript
// src/ai-worker.ts
import { setupWorkerHandler } from '@store-ai/core';

setupWorkerHandler();
```

The handler supports all built-in providers: `anthropic`, `openai`, `openai-responses`, `ai-sdk-data-stream`.

### 2. Use in Main Thread

```typescript
import { createAIStore, createWorkerStream } from '@store-ai/core';

const store = createAIStore();

const response = await fetch('/api/chat', { method: 'POST', body: '...' });

const events = createWorkerStream({
  worker: new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' }),
  stream: response.body!,
  provider: 'anthropic',
});

store.submit({ events });
```

## How It Works

```
Main Thread                    Worker Thread
───────────                    ─────────────
fetch() → response.body
    │
    ├─── chunk ──────────────► SSE Parser → Provider → StreamEvent
    ├─── chunk ──────────────► SSE Parser → Provider → StreamEvent
    ├─── chunk ──────────────►                              │
    │                                                       │
    │ ◄────────── StreamEvent ──────────────────────────────┘
    │ ◄────────── StreamEvent
    ▼
store.dispatch()
```

Chunks are transferred with zero-copy (`Transferable`). Events are posted back as structured clones.

## Options

```typescript
interface WorkerStreamOptions {
  worker: Worker;
  stream: ReadableStream<Uint8Array>;
  provider: string; // 'anthropic' | 'openai' | 'openai-responses' | 'ai-sdk-data-stream'
  streamId?: string; // for multiplexing (auto-generated if omitted)
  signal?: AbortSignal;
}
```

## Abort

Aborting sends an abort message to the worker:

```typescript
store.abort(); // worker receives abort, stops parsing
```

## Multiplexing

Multiple streams can share a single worker via `streamId`:

```typescript
const events1 = createWorkerStream({
  worker,
  stream: stream1,
  provider: 'anthropic',
  streamId: 'chat-1',
});
const events2 = createWorkerStream({
  worker,
  stream: stream2,
  provider: 'openai',
  streamId: 'chat-2',
});
```
