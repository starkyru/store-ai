# Core Concepts

## Architecture

store-ai is organized in layers. Each layer depends only on the one below it, and you can use any layer independently:

```
Layer 4: Framework Adapters   (React, Vue, Svelte, Solid)
Layer 3: Store Adapters       (Zustand, Jotai, Nanostores, Valtio, Redux, TanStack)
Layer 2: Stream Pipeline      (Provider normalizer -> Middleware chain -> State reducer)
Layer 1: Vanilla Core Store   (get / subscribe / submit / abort)
Layer 0: Stream Primitives    (SSE parser, NDJSON parser, partial JSON, AbortController)
```

## State Shape

Every `AIStore` exposes this state:

```typescript
interface AIState<T = unknown> {
  // Stream lifecycle
  status: 'idle' | 'connecting' | 'streaming' | 'complete' | 'error' | 'aborted';
  error: Error | null;

  // Text
  text: string; // accumulated response text
  textDelta: string; // latest chunk

  // Messages
  messages: Message[]; // full conversation
  lastMessage: Message | null;

  // Structured output
  partialObject: DeepPartial<T> | null; // incrementally parsed, Zod-validated
  object: T | null; // final validated result

  // Tool calls
  toolCalls: ToolCallState[];

  // Reasoning
  thinking: string; // accumulated thinking tokens
  thinkingDelta: string;

  // Metadata
  usage: TokenUsage | null; // { inputTokens, outputTokens, reasoningTokens }
  latency: LatencyInfo | null; // { ttft, totalMs }
  model: string | null;
  provider: string | null;

  // Computed
  isStreaming: boolean;
  isIdle: boolean;
  isError: boolean;
  hasMessages: boolean;
  pendingToolCalls: ToolCallState[];
  completedToolCalls: ToolCallState[];
}
```

### Status Lifecycle

The `status` field follows this lifecycle:

```
idle -> connecting -> streaming -> complete
                  \-> error
                  \-> aborted
```

- **idle**: No active stream. Initial state and after `reset()`.
- **connecting**: Stream initiated but no content received yet.
- **streaming**: Content is arriving. `text`, `textDelta`, etc. are updating.
- **complete**: Stream finished normally.
- **error**: Stream failed. Check `error` for details.
- **aborted**: Stream was cancelled via `abort()`. Accumulated text and messages are preserved.

### Messages

Messages use a structured content format:

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent[];
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCall: ToolCallState }
  | { type: 'tool-result'; toolCallId: string; result: unknown }
  | { type: 'thinking'; text: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'file'; url: string; mimeType: string; name?: string };
```

## Reading State

Use `store.get()` to read the current state:

```typescript
store.get(); // full state object
store.get('text'); // just the text
store.get('status'); // just the status
store.get('messages'); // just the messages
```

## Subscribing to Changes

Use `store.subscribe()` to be notified when state changes:

```typescript
// Full state changes
const unsub = store.subscribe((state, prev) => {
  console.log('State changed:', state.status);
});

// Specific key (only fires when that key changes)
const unsub = store.subscribe('text', (text, prevText) => {
  console.log('New text:', text);
});

// Unsubscribe when done
unsub();
```

Key-specific subscriptions use shallow comparison and only fire when the selected value actually changes. This prevents unnecessary work in your UI layer.

## Submitting Requests

Use `store.submit()` to start a stream or process a complete response:

```typescript
// Streaming — pass a byte stream
store.submit({
  message: 'Hello',
  stream: response.body,
});

// Non-streaming — pass a complete response object
store.submit({
  message: 'Hello',
  response: {
    text: 'Hi there!',
    usage: { inputTokens: 10, outputTokens: 5 },
  },
});

// Full conversation (streaming)
store.submit({
  messages: [
    { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  ],
  stream: response.body,
});

// Bring your own stream (skip provider adapter)
store.submit({
  events: myCustomEventStream,
});
```

`submit()` returns a `StreamHandle` with `abort()` and `signal` for cancellation control.

### Non-Streaming Responses

The `response` field accepts a `CompleteResponse` object for request-response APIs that return a full result at once:

```typescript
interface CompleteResponse {
  text?: string;
  thinking?: string;
  toolCalls?: { id: string; name: string; input: unknown }[];
  object?: DeepPartial<unknown> | null;
  usage?: Partial<TokenUsage>;
  finishReason?: FinishReason;
}
```

Internally, the response is converted to stream events and flows through the same middleware pipeline and reducer. This means persistence, logging, cost tracking, and all other middleware works identically regardless of whether the response was streamed or complete.

## Notification Batching

During streaming, the store receives many rapid updates (every token). The store uses **microtask batching** by default, coalescing updates so listeners are called at most once per microtask:

```typescript
createAIStore({
  batchStrategy: 'microtask', // default
  // batchStrategy: 'raf',    // batch per requestAnimationFrame
  // batchStrategy: 'sync',   // no batching, immediate notification
});
```

This gives roughly 60fps update rate without explicit throttling. For even more control, use the `throttle` middleware.

## Next Steps

- [Providers](/guide/providers) -- configure stream sources
- [Middleware](/guide/middleware) -- add processing to the stream pipeline
- [Store Adapters](/guide/store-adapters) -- connect to your state management library
- [Framework Adapters](/guide/framework-adapters) -- use framework-specific hooks
