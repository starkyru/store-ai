# store-ai Architecture

## Overview

store-ai is a framework-agnostic, store-agnostic TypeScript library that mediates between AI streaming APIs and reactive state management. It provides a composable pipeline for consuming, transforming, and exposing AI stream data through any state management solution.

```
AI Provider Stream ──> Pipeline ──> Vanilla Core Store ──> Store Adapter ──> Framework Adapter ──> UI
     (SSE)          (middleware)    (get/set/subscribe)    (zustand/jotai)   (react/vue/svelte)
```

## Design Principles

1. **Zero-dependency core** — The vanilla core has no runtime dependencies. Everything is an optional adapter.
2. **Subscribe contract as the universal seam** — `get()` / `set()` / `subscribe()` is the only interface between layers. Any store or framework that can implement this contract can integrate.
3. **Streams in, state out** — The library consumes `ReadableStream`, `AsyncIterator`, or SSE responses and produces reactive state. It never makes HTTP requests itself (that's your job or a provider adapter's job).
4. **Composable middleware** — Every processing step (parsing, validation, throttling, logging, persistence) is a middleware you opt into. Nothing is baked in.
5. **Progressive disclosure** — Simple things are simple. `createAIStore()` with a stream works in 3 lines. Middleware, multi-chat, structured output — available when you need them.

---

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: Framework Adapters                                    │
│  useAIStore() (React) · useAI() (Vue) · $ai (Svelte) · ...     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Store Adapters                                        │
│  toZustand() · toJotai() · toNanostores() · toRedux() · ...    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Stream Pipeline                                       │
│  Provider Normalizer → Middleware Chain → State Reducer          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Vanilla Core Store                                    │
│  AIStore { get() · set() · subscribe() · dispatch() }           │
├─────────────────────────────────────────────────────────────────┤
│  Layer 0: Stream Primitives                                     │
│  SSE Parser · NDJSON Parser · Partial JSON · AbortController    │
└─────────────────────────────────────────────────────────────────┘
```

Each layer depends only on the layer below it. You can use any layer independently.

---

## Layer 0: Stream Primitives

Zero-dependency utilities for working with AI streams. These are pure functions and `TransformStream` implementations.

### SSE Parser

Transforms a `ReadableStream<Uint8Array>` (from `fetch`) into a stream of parsed SSE events.

```typescript
interface SSEEvent {
  event?: string; // event type (e.g., "message_start", "content_block_delta")
  data: string; // raw data payload
  id?: string; // optional event ID
  retry?: number; // optional reconnect interval
}

function createSSEParser(): TransformStream<Uint8Array, SSEEvent>;
```

Implementation: Text decoding → line splitting → SSE frame assembly. Handles multi-line `data:` fields, empty lines as delimiters, BOM stripping, and `[DONE]` sentinel.

### NDJSON Parser

```typescript
function createNDJSONParser<T>(): TransformStream<Uint8Array, T>;
```

### Partial JSON Parser

Incrementally repairs and parses incomplete JSON from streams. O(n) total work across all chunks (not O(n^2) reparse).

```typescript
interface PartialJSONParser<T> {
  push(chunk: string): DeepPartial<T> | null;
  getPartial(): DeepPartial<T> | null;
  getFinal(): T | null;
  reset(): void;
}

function createPartialJSONParser<T>(schema?: ZodType<T>): PartialJSONParser<T>;
```

Uses a state machine to track JSON nesting context (open braces, quotes, escapes) and appends closing tokens to produce valid JSON at any point. When a Zod schema is provided, partial results are validated against `schema.deepPartial()`.

### Abort Integration

```typescript
interface StreamHandle {
  stream: ReadableStream<SSEEvent>;
  abort(): void;
  signal: AbortSignal;
}

function attachAbort(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): StreamHandle;
```

Composes external abort signals with internal abort controllers. Calling `abort()` cancels the fetch, releases the reader lock, and transitions store status to `"aborted"`.

---

## Layer 1: Vanilla Core Store

The heart of the library. A framework-agnostic reactive store that holds the complete state of an AI stream interaction.

### State Shape

```typescript
interface AIState<TStructured = unknown> {
  // ── Stream lifecycle ──
  status: 'idle' | 'connecting' | 'streaming' | 'complete' | 'error' | 'aborted';
  error: Error | null;

  // ── Text accumulation ──
  text: string; // full accumulated text
  textDelta: string; // latest text chunk (resets each chunk)

  // ── Messages ──
  messages: Message[]; // full conversation history
  lastMessage: Message | null; // most recent message (any role)

  // ── Structured output ──
  partialObject: DeepPartial<TStructured> | null; // incrementally parsed
  object: TStructured | null; // final validated result

  // ── Tool calls ──
  toolCalls: ToolCallState[]; // all tool calls (pending + completed)

  // ── Reasoning / thinking ──
  thinking: string; // accumulated thinking tokens
  thinkingDelta: string;

  // ── Metadata ──
  usage: TokenUsage | null;
  latency: LatencyInfo | null;
  model: string | null;
  provider: string | null;

  // ── Derived (computed, not stored) ──
  isStreaming: boolean; // status === "streaming"
  isIdle: boolean; // status === "idle"
  isError: boolean; // status === "error"
  hasMessages: boolean;
  pendingToolCalls: ToolCallState[]; // toolCalls.filter(t => t.status === "pending")
  completedToolCalls: ToolCallState[];
}
```

### Supporting Types

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

interface ToolCallState {
  id: string;
  name: string;
  status: 'pending' | 'partial' | 'complete' | 'error';
  input: unknown; // partial during streaming, complete after
  inputText: string; // raw JSON text (for display before parse completes)
  output: unknown | null;
  error: Error | null;
  startedAt: Date;
  completedAt: Date | null;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number; // computed
}

interface LatencyInfo {
  startMs: number; // stream start timestamp
  firstTokenMs: number | null; // first content token timestamp
  endMs: number | null; // stream end timestamp
  ttft: number | null; // time to first token (ms)
  totalMs: number | null; // total duration (ms)
}
```

### Store Interface

```typescript
interface AIStore<TStructured = unknown> {
  // ── Read ──
  get(): AIState<TStructured>;
  get<K extends keyof AIState<TStructured>>(key: K): AIState<TStructured>[K];

  // ── Subscribe ──
  subscribe(
    listener: (state: AIState<TStructured>, prev: AIState<TStructured>) => void,
  ): () => void;
  subscribe<K extends keyof AIState<TStructured>>(
    key: K,
    listener: (value: AIState<TStructured>[K], prev: AIState<TStructured>[K]) => void,
  ): () => void;

  // ── Actions ──
  submit(input: SubmitInput): StreamHandle;
  abort(): void;
  reset(): void;
  setMessages(messages: Message[]): void;
  addToolResult(toolCallId: string, result: unknown): void;
  retry(): StreamHandle;

  // ── Pipeline ──
  use(middleware: Middleware): () => void; // returns unsubscribe

  // ── Lifecycle ──
  destroy(): void;
}

interface SubmitInput {
  messages?: Message[]; // append to conversation
  message?: string; // shorthand: single user message
  stream?: ReadableStream; // bring your own stream
  body?: Record<string, unknown>; // extra body params for provider
  signal?: AbortSignal;
  headers?: Record<string, string>;
}
```

### Internal Architecture

The store uses a **reducer pattern** for state transitions, similar to TanStack Query:

```typescript
type StoreAction =
  | { type: 'stream/start'; meta: StreamMeta }
  | { type: 'stream/text-delta'; delta: string }
  | { type: 'stream/thinking-delta'; delta: string }
  | { type: 'stream/tool-call-start'; toolCall: Partial<ToolCallState> }
  | { type: 'stream/tool-call-delta'; toolCallId: string; inputDelta: string }
  | { type: 'stream/tool-call-complete'; toolCallId: string; input: unknown }
  | { type: 'stream/object-delta'; partial: DeepPartial<unknown> }
  | { type: 'stream/complete'; usage?: TokenUsage }
  | { type: 'stream/error'; error: Error }
  | { type: 'stream/abort' }
  | { type: 'messages/set'; messages: Message[] }
  | { type: 'messages/append'; message: Message }
  | { type: 'tool/result'; toolCallId: string; result: unknown }
  | { type: 'reset' };

function aiReducer<T>(state: AIState<T>, action: StoreAction): AIState<T>;
```

The reducer is pure. Side effects (stream consumption, middleware) happen outside in the dispatch layer.

### Notification Batching

During streaming, the store receives many rapid updates (every token). Naive notification would cause excessive re-renders. The store uses **microtask batching**:

```
Token 1 arrives → state updated, notification queued (queueMicrotask)
Token 2 arrives → state updated, same queued notification
Token 3 arrives → state updated, same queued notification
── microtask fires ── → all listeners called once with latest state
```

This gives ~60fps update rate without explicit throttling. Configurable via `batchStrategy`:

```typescript
createAIStore({
  batchStrategy: "microtask",        // default: batch per microtask
  // or
  batchStrategy: "raf",              // batch per requestAnimationFrame
  // or
  batchStrategy: "sync",            // no batching, immediate notification
  // or
  batchStrategy: (notify) => { ... } // custom
});
```

---

## Layer 2: Stream Pipeline

The pipeline transforms raw stream data into store actions. It's a chain of `TransformStream` instances composed via `pipeThrough`.

### Pipeline Flow

```
fetch response.body (ReadableStream<Uint8Array>)
       │
       ▼
┌──────────────┐
│  SSE Parser  │   Layer 0 primitive
└──────┬───────┘
       │  SSEEvent
       ▼
┌──────────────────┐
│ Provider Adapter  │   Normalizes provider-specific events into StreamEvent
└──────┬───────────┘
       │  StreamEvent (unified)
       ▼
┌──────────────────┐
│ Middleware Chain  │   User-defined transforms, logging, validation, etc.
└──────┬───────────┘
       │  StreamEvent (possibly transformed)
       ▼
┌──────────────────┐
│  State Reducer   │   Maps StreamEvents to StoreActions, updates state
└──────────────────┘
```

### StreamEvent (Unified Event Format)

All provider-specific formats are normalized into this:

```typescript
type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id: string; inputDelta: string }
  | { type: 'tool-call-end'; id: string; input: unknown }
  | { type: 'object-delta'; text: string; partial: DeepPartial<unknown> | null }
  | { type: 'usage'; usage: Partial<TokenUsage> }
  | { type: 'metadata'; key: string; value: unknown }
  | { type: 'error'; error: Error }
  | { type: 'finish'; reason: 'stop' | 'tool-calls' | 'length' | 'error' }
  | { type: 'step-start'; stepId: string }
  | { type: 'step-end'; stepId: string };
```

### Provider Adapters

Provider adapters are `TransformStream<SSEEvent, StreamEvent>` implementations that normalize provider-specific SSE formats:

```typescript
interface ProviderAdapter {
  name: string;
  createTransform(): TransformStream<SSEEvent, StreamEvent>;
}

// Built-in adapters
const anthropic: ProviderAdapter; // message_start, content_block_delta, etc.
const openai: ProviderAdapter; // choices[0].delta.content, etc.
const openaiResponses: ProviderAdapter; // response.output_text.delta, etc.
const aiSdkDataStream: ProviderAdapter; // AI SDK UI Message Stream protocol
const passthrough: ProviderAdapter; // raw text stream (no SSE framing)
```

You can also bring a raw `AsyncIterator<StreamEvent>` or `ReadableStream<StreamEvent>` and skip the provider layer entirely.

### Middleware System

Middleware intercepts `StreamEvent`s flowing through the pipeline. Each middleware can observe, transform, delay, or suppress events.

```typescript
interface MiddlewareContext {
  event: StreamEvent;
  state: Readonly<AIState>; // current store state (read-only snapshot)
  store: AIStore; // full store reference (for reads; writes via event transforms)
  metadata: Map<string, unknown>; // shared across middleware for this stream
}

type MiddlewareFn = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void> | void;

// Middleware can also be an object with lifecycle hooks
interface MiddlewareObject {
  name?: string;
  onStart?(ctx: { state: AIState; store: AIStore }): void | Promise<void>;
  onEvent?: MiddlewareFn;
  onComplete?(ctx: { state: AIState; store: AIStore }): void | Promise<void>;
  onError?(error: Error, ctx: { state: AIState; store: AIStore }): void | Promise<void>;
  onAbort?(ctx: { state: AIState; store: AIStore }): void | Promise<void>;
}

type Middleware = MiddlewareFn | MiddlewareObject;
```

#### Built-in Middleware

```typescript
// Logging
function logging(opts?: {
  level?: 'debug' | 'info';
  filter?: (e: StreamEvent) => boolean;
}): Middleware;

// Zod validation for structured output
function validateSchema<T>(schema: ZodType<T>): Middleware;

// Throttle state updates (for very fast streams)
function throttle(ms: number): Middleware;

// Persist messages to storage
function persist(storage: StorageAdapter): Middleware;

// Retry on transient errors
function retryOn(opts: {
  maxRetries: number;
  delay: number;
  filter?: (e: Error) => boolean;
}): Middleware;

// Cost tracking
function trackCost(pricing: ProviderPricing): Middleware;

// Custom event transforms
function mapEvents(fn: (event: StreamEvent) => StreamEvent | null): Middleware;
```

#### Middleware Execution Order

```
Event arrives
  │
  ▼
middleware[0].onEvent(ctx, next)
  │  calls next() ──▶ middleware[1].onEvent(ctx, next)
  │                      │  calls next() ──▶ middleware[2].onEvent(ctx, next)
  │                      │                      │  calls next() ──▶ state reducer
  │                      │                      │  ◀── returns ────────┘
  │                      │  ◀── returns ────────┘
  │  ◀── returns ────────┘
done
```

If a middleware does not call `next()`, the event is suppressed (never reaches the reducer). This enables filtering, buffering, and conditional processing.

---

## Layer 3: Store Adapters

Thin wrappers (~20-50 LOC each) that project the `AIStore`'s `get/subscribe` contract into a specific state management library's primitives.

### Adapter Interface

Every store adapter implements this contract:

```typescript
interface StoreAdapterResult<TStore> {
  store: TStore; // the native store object (zustand store, jotai atom, etc.)
  destroy(): void; // cleanup subscriptions
}

type StoreAdapterFactory<TStore> = (aiStore: AIStore) => StoreAdapterResult<TStore>;
```

### Zustand Adapter

```typescript
import { createStore } from 'zustand/vanilla';

function toZustand<T>(aiStore: AIStore<T>) {
  const zStore = createStore(() => aiStore.get());
  const unsub = aiStore.subscribe((state) => zStore.setState(state, true));
  return {
    store: zStore,
    destroy: unsub,
  };
}
```

Usage:

```typescript
import { useStore } from 'zustand';
const zStore = toZustand(aiStore);
const text = useStore(zStore.store, (s) => s.text);
```

### Jotai Adapter

```typescript
import { atom } from 'jotai';

function toJotai<T>(aiStore: AIStore<T>) {
  const baseAtom = atom(aiStore.get());
  // Writable atom that subscribes on mount
  const aiAtom = atom(
    (get) => get(baseAtom),
    (_get, set) => {
      const unsub = aiStore.subscribe((state) => set(baseAtom, state));
      return unsub;
    },
  );
  // Derived atoms for selectors
  aiAtom.text = atom((get) => get(baseAtom).text);
  aiAtom.status = atom((get) => get(baseAtom).status);
  aiAtom.messages = atom((get) => get(baseAtom).messages);
  // ...
  return { store: aiAtom, destroy: () => {} };
}
```

### Nanostores Adapter

```typescript
import { map } from 'nanostores';

function toNanostores<T>(aiStore: AIStore<T>) {
  const $ai = map(aiStore.get());
  const unsub = aiStore.subscribe((state) => $ai.set(state));
  return { store: $ai, destroy: unsub };
}
```

Works automatically with React (`@nanostores/react`), Vue (`@nanostores/vue`), Svelte (native `$store`), Solid, Lit, and Angular.

### Redux Adapter

```typescript
function toRedux<T>(aiStore: AIStore<T>) {
  // Returns a Redux slice definition
  return {
    slice: createSlice({
      name: 'ai',
      initialState: aiStore.get(),
      reducers: {
        sync: (_state, action) => action.payload,
      },
    }),
    // Call this in your store setup to start syncing
    startSync(dispatch: Dispatch) {
      return aiStore.subscribe((state) => dispatch(sync(state)));
    },
  };
}
```

### @tanstack/store Adapter

```typescript
import { Store } from '@tanstack/store';

function toTanstack<T>(aiStore: AIStore<T>) {
  const store = new Store(aiStore.get());
  const unsub = aiStore.subscribe((state) => store.setState(() => state));
  return { store, destroy: unsub };
}
```

### Valtio Adapter

```typescript
import { proxy, ref } from 'valtio';

function toValtio<T>(aiStore: AIStore<T>) {
  const state = proxy(aiStore.get());
  const unsub = aiStore.subscribe((next) => Object.assign(state, next));
  return { store: state, destroy: unsub };
}
```

---

## Layer 4: Framework Adapters

Optional hooks/composables that combine `AIStore` + the right store adapter for a specific framework. These are convenience packages — you can always use a store adapter directly.

### React

```typescript
// @store-ai/react
import { useSyncExternalStore, useCallback } from 'react';

function useAIStore<T, S>(store: AIStore<T>, selector: (s: AIState<T>) => S): S {
  return useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    () => selector(store.get()),
  );
}

// Convenience hooks
function useAIText(store: AIStore): string;
function useAIStatus(store: AIStore): AIState['status'];
function useAIMessages(store: AIStore): Message[];
function useAIToolCalls(store: AIStore): ToolCallState[];
function useAIObject<T>(store: AIStore<T>): DeepPartial<T> | null;
function useAIThinking(store: AIStore): string;
```

### Vue

```typescript
// @store-ai/vue
import { shallowRef, onScopeDispose } from 'vue';

function useAI<T>(store: AIStore<T>) {
  const state = shallowRef(store.get());
  const unsub = store.subscribe((s) => {
    state.value = s;
  });
  onScopeDispose(unsub);
  return {
    state: readonly(state),
    text: computed(() => state.value.text),
    status: computed(() => state.value.status),
    messages: computed(() => state.value.messages),
    // ...
  };
}
```

### Svelte

```typescript
// @store-ai/svelte
// Svelte recognizes any object with .subscribe() — AIStore works natively.
// This package provides typed derived stores.

import { derived, type Readable } from 'svelte/store';

function createAIReadable<T>(store: AIStore<T>): Readable<AIState<T>> & {
  text: Readable<string>;
  status: Readable<AIState['status']>;
  messages: Readable<Message[]>;
};
```

### Solid

```typescript
// @store-ai/solid
import { createSignal, onCleanup } from 'solid-js';

function useAI<T>(store: AIStore<T>) {
  const [state, setState] = createSignal(store.get());
  const unsub = store.subscribe((s) => setState(s));
  onCleanup(unsub);
  return state;
}
```

---

## Multi-Chat Architecture

The `ChatManager` coordinates multiple `AIStore` instances:

```typescript
interface ChatManager {
  // ── Chat lifecycle ──
  create(id?: string, opts?: ChatOptions): AIStore;
  get(id: string): AIStore | undefined;
  delete(id: string): void;
  list(): ChatInfo[];

  // ── Active chat ──
  activeId: string | null;
  active: AIStore | null;
  setActive(id: string): void;

  // ── Global subscribe ──
  subscribe(listener: (chats: ChatInfo[]) => void): () => void;
  onAny(event: string, listener: (chatId: string, state: AIState) => void): () => void;

  // ── Lifecycle ──
  destroy(): void;
}

interface ChatInfo {
  id: string;
  title: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  status: AIState['status'];
}

function createChatManager(defaults?: Partial<AIStoreOptions>): ChatManager;
```

Each chat is an independent `AIStore` with its own middleware stack, stream, and state. The `ChatManager` is a lightweight registry with its own subscribe contract for UI frameworks to bind to.

---

## Persistence Architecture

Persistence is handled via middleware, not baked into the core:

```typescript
interface StorageAdapter {
  get(key: string): Promise<SerializedChat | null>;
  set(key: string, value: SerializedChat): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

interface SerializedChat {
  id: string;
  messages: Message[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Built-in storage adapters
function memoryStorage(): StorageAdapter;
function localStorageAdapter(prefix?: string): StorageAdapter;
function indexedDBAdapter(dbName?: string): StorageAdapter;

// Usage
const store = createAIStore({
  middleware: [persist(localStorageAdapter('my-app'))],
});
```

---

## Error Handling Strategy

Errors can occur at multiple levels:

| Level      | Error Source           | Handling                                                                                                 |
| ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Network    | Fetch failure, timeout | Store transitions to `status: "error"`, `error` is set. Retry middleware can auto-retry.                 |
| SSE Parse  | Malformed SSE frames   | Parser emits error event. Store captures it. Stream continues if possible.                               |
| Provider   | API error responses    | Provider adapter emits `{ type: "error" }` StreamEvent.                                                  |
| Middleware | User middleware throws | Error propagates, stream aborts, `status: "error"`. Logged if logging middleware is active.              |
| JSON Parse | Invalid partial JSON   | Parser returns last valid partial. No store error — partial remains stale until next valid chunk.        |
| Validation | Zod validation failure | `validateSchema` middleware emits warning metadata. Does not block stream. Final validation on complete. |
| Abort      | User-initiated cancel  | `status: "aborted"`. Current text/messages preserved. No error.                                          |

---

## Package Structure (Monorepo)

```
store-ai/
├── packages/
│   ├── core/                    # @store-ai/core — Layer 0 + 1
│   │   ├── src/
│   │   │   ├── store.ts         # AIStore implementation
│   │   │   ├── reducer.ts       # Pure state reducer
│   │   │   ├── types.ts         # All type definitions
│   │   │   ├── pipeline.ts      # Stream pipeline composition
│   │   │   ├── middleware.ts     # Middleware chain execution
│   │   │   ├── chat-manager.ts  # Multi-chat coordinator
│   │   │   ├── parsers/
│   │   │   │   ├── sse.ts       # SSE parser TransformStream
│   │   │   │   ├── ndjson.ts    # NDJSON parser TransformStream
│   │   │   │   └── partial-json.ts  # Incremental JSON parser
│   │   │   ├── providers/
│   │   │   │   ├── anthropic.ts
│   │   │   │   ├── openai.ts
│   │   │   │   ├── openai-responses.ts
│   │   │   │   └── ai-sdk-data-stream.ts
│   │   │   └── middleware/
│   │   │       ├── logging.ts
│   │   │       ├── validate-schema.ts
│   │   │       ├── throttle.ts
│   │   │       ├── persist.ts
│   │   │       ├── retry.ts
│   │   │       └── track-cost.ts
│   │   └── package.json
│   │
│   ├── zustand/                 # @store-ai/zustand
│   ├── jotai/                   # @store-ai/jotai
│   ├── nanostores/              # @store-ai/nanostores
│   ├── redux/                   # @store-ai/redux
│   ├── valtio/                  # @store-ai/valtio
│   ├── tanstack/                # @store-ai/tanstack
│   │
│   ├── react/                   # @store-ai/react
│   ├── vue/                     # @store-ai/vue
│   ├── svelte/                  # @store-ai/svelte
│   └── solid/                   # @store-ai/solid
│
├── docs/
├── examples/
│   ├── react-zustand/
│   ├── react-jotai/
│   ├── vue-nanostores/
│   ├── svelte-basic/
│   └── vanilla/
└── tests/
    ├── core/
    ├── integration/
    └── e2e/
```

---

## Testing Strategy

Given that the two closest competitors have literally **zero tests**, testing is a key differentiator.

### Test Categories

1. **Unit tests** (vitest) — Reducer purity, parser correctness, middleware isolation
2. **Stream integration tests** — Full pipeline from raw bytes to state, using recorded SSE fixtures from real providers
3. **Edge case tests** — Abort mid-stream, reconnect, partial JSON at every possible break point, empty streams, provider errors, rate limits
4. **Store adapter tests** — Each adapter correctly reflects state changes
5. **Memory leak tests** — Long-running streams don't leak listeners, streams, or buffers
6. **Concurrency tests** — Multiple simultaneous streams, rapid abort/retry cycles, race conditions

### Test Fixtures

Real SSE recordings from each provider, stored as `.sse` fixture files:

```
tests/fixtures/
├── anthropic/
│   ├── simple-text.sse
│   ├── tool-call.sse
│   ├── thinking.sse
│   ├── error-rate-limit.sse
│   └── structured-output.sse
├── openai/
│   ├── chat-completion.sse
│   ├── responses-api.sse
│   ├── function-call.sse
│   └── streaming-error.sse
└── edge-cases/
    ├── abort-mid-token.sse
    ├── empty-stream.sse
    ├── utf8-multibyte-split.sse
    └── malformed-sse.sse
```

---

## Performance Considerations

1. **Structural sharing** — When updating `messages`, only the last message reference changes. Previous message references are preserved to avoid unnecessary re-renders in UI frameworks.

2. **Selector-based subscription** — `store.subscribe(key, listener)` only fires when that specific key's value changes (shallow compare), not on every state update.

3. **Lazy computed properties** — `pendingToolCalls`, `completedToolCalls`, `isStreaming`, etc. are computed on access and cached until the underlying data changes.

4. **Zero-copy parsing** — SSE parser operates on `TextDecoder` stream mode, avoiding intermediate string concatenation where possible.

5. **Memory** — `destroy()` releases all listeners, aborts active streams, and clears internal caches. Store adapters clean up their own subscriptions.
