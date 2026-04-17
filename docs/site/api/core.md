# Core API

Full API reference for `@store-ai/core`.

## `createAIStore(options?)`

Creates a new AI store instance.

```typescript
interface AIStoreOptions<T = unknown> {
  provider?: ProviderAdapter;
  middleware?: Middleware[];
  schema?: ZodType<T>;
  initialMessages?: Message[];
  batchStrategy?: 'microtask' | 'raf' | 'sync' | ((notify: () => void) => void);
}

function createAIStore<T = unknown>(options?: AIStoreOptions<T>): AIStore<T>;
```

## `store.get(key?)`

Read current state or a specific key.

```typescript
store.get(); // full AIState
store.get('text'); // string
store.get('status'); // "idle" | "streaming" | ...
store.get('messages'); // Message[]
```

## `store.subscribe(listener)` / `store.subscribe(key, listener)`

Subscribe to state changes. Returns an unsubscribe function.

```typescript
// Full state
const unsub = store.subscribe((state, prev) => { ... });

// Specific key (only fires when that key changes)
const unsub = store.subscribe('text', (text, prevText) => { ... });
```

## `store.submit(input)`

Start a new stream. Returns a `StreamHandle` with `abort()` and `signal`.

```typescript
interface SubmitInput {
  messages?: Message[];
  message?: string;
  stream?: ReadableStream;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

store.submit({ message: 'Hello', stream: response.body });
```

## `store.abort()`

Abort the active stream. Status transitions to `"aborted"`. Accumulated text and messages are preserved.

## `store.reset()`

Reset state to initial values. Aborts any active stream.

## `store.retry()`

Re-submit the last request. Returns a new `StreamHandle`.

## `store.setMessages(messages)`

Replace the message history.

## `store.addToolResult(toolCallId, result)`

Provide a result for a pending tool call.

## `store.use(middleware)`

Add middleware at runtime. Returns an unsubscribe function.

## `store.destroy()`

Clean up all subscriptions, abort active streams, release resources.

## `createChatManager(defaults?)`

Create a multi-chat coordinator. See the [Multi-Chat guide](/guide/multi-chat).

## `restoreChat(storage, chatId)`

Restore a previously persisted conversation. Returns `SerializedChat | null`.

## `listChats(storage)`

List all persisted chat IDs from a storage adapter.

## `deleteChat(storage, chatId)`

Delete a persisted conversation.

## `createPartialJSONParser<T>()`

Create an incremental JSON parser for streaming structured output.

```typescript
const parser = createPartialJSONParser<MyType>();
parser.push('{"name": "Jo'); // { name: "Jo" }
parser.push('hn"}'); // { name: "John" }
parser.getFinal(); // { name: "John" }
parser.reset();
```

## State Types

See the [Core Concepts guide](/guide/core-concepts) for full type definitions of `AIState`, `Message`, `MessageContent`, `ToolCallState`, `TokenUsage`, and `LatencyInfo`.
