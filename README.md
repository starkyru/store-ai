# store-ai

Framework-agnostic, store-agnostic AI stream state management for TypeScript.

```
npm install @store-ai/core
```

store-ai sits between your AI streaming API and your UI framework. It consumes any AI stream (OpenAI, Anthropic, Vercel AI SDK, or raw SSE), processes it through a composable middleware pipeline, and exposes reactive state through the store of your choice (Zustand, Jotai, Nanostores, Redux, Valtio, or vanilla).

```
Stream (SSE/NDJSON) → Pipeline (middleware) → Core Store → Store Adapter → Framework Adapter → UI
```

## Why?

Every existing AI + state solution is locked to one framework and one store:

| Library             | Framework        | Store             | Tests   | Middleware |
| ------------------- | ---------------- | ----------------- | ------- | ---------- |
| Vercel AI SDK       | React/Vue/Svelte | Internal (locked) | Yes     | No         |
| @ai-sdk-tools/store | React only       | Zustand only      | None    | No         |
| assistant-ui        | React only       | Internal zustand  | Some    | No         |
| **store-ai**        | **Any**          | **Any**           | **Yes** | **Yes**    |

store-ai is the missing layer — a headless, tested, extensible core that works with whatever you already use.

---

## Quick Start

### Vanilla (zero dependencies)

```typescript
import { createAIStore, anthropic } from '@store-ai/core';

const store = createAIStore({
  provider: anthropic(),
});

// Start streaming
const handle = store.submit({
  message: 'Explain quantum computing',
  // Pass your fetch response, or let the provider adapter handle it
  stream: await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'Explain quantum computing' }),
  }).then((r) => r.body!),
});

// Subscribe to changes
store.subscribe('text', (text) => {
  document.getElementById('output')!.textContent = text;
});

store.subscribe('status', (status) => {
  console.log('Status:', status); // idle → connecting → streaming → complete
});

// Abort if needed
handle.abort();
```

### React + Zustand

```typescript
import { createAIStore } from '@store-ai/core';
import { toZustand } from '@store-ai/zustand';
import { useStore } from 'zustand';

// Create once (outside component)
const aiStore = createAIStore({ provider: anthropic() });
const { store: zStore } = toZustand(aiStore);

function ChatMessage() {
  const text = useStore(zStore, (s) => s.text);
  const status = useStore(zStore, (s) => s.status);

  return <div>{status === 'streaming' ? text + '...' : text}</div>;
}

function ChatInput() {
  const submit = () => aiStore.submit({ message: input });
  const abort = () => aiStore.abort();
  // ...
}
```

### React (built-in hooks)

```typescript
import { createAIStore } from '@store-ai/core';
import { useAIStore, useAIText, useAIStatus } from '@store-ai/react';

const store = createAIStore({ provider: anthropic() });

function StreamingText() {
  const text = useAIText(store);
  const status = useAIStatus(store);
  return <p>{text}</p>;
}
```

### Vue

```typescript
import { createAIStore } from '@store-ai/core';
import { useAI } from '@store-ai/vue';

const store = createAIStore({ provider: openai() });

// In setup()
const { text, status, messages } = useAI(store);
```

### Svelte

```svelte
<script>
  import { createAIStore } from '@store-ai/core';
  import { createAIReadable } from '@store-ai/svelte';

  const store = createAIStore({ provider: openai() });
  const ai = createAIReadable(store);
</script>

<p>{$ai.text}</p>
<span>Status: {$ai.status}</span>
```

### Solid

```typescript
import { createAIStore } from '@store-ai/core';
import { useAI } from '@store-ai/solid';

const store = createAIStore({ provider: anthropic() });

function App() {
  const state = useAI(store);
  return <p>{state().text}</p>;
}
```

---

## Core Concepts

### State Shape

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

### Provider Adapters

Provider adapters normalize different SSE formats into a unified `StreamEvent` type:

```typescript
import { anthropic, openai, openaiResponses, aiSdkDataStream } from '@store-ai/core';

// Anthropic (message_start, content_block_delta, etc.)
const store = createAIStore({ provider: anthropic() });

// OpenAI Chat Completions (choices[0].delta.content)
const store = createAIStore({ provider: openai() });

// OpenAI Responses API (response.output_text.delta)
const store = createAIStore({ provider: openaiResponses() });

// Vercel AI SDK Data Stream protocol
const store = createAIStore({ provider: aiSdkDataStream() });

// Raw text stream (no SSE framing)
const store = createAIStore({ provider: passthrough() });
```

Or skip providers entirely and feed any stream:

```typescript
const store = createAIStore();

// Feed a ReadableStream<StreamEvent> directly
store.submit({
  events: myCustomEventStream,
});

// Or an AsyncIterator
store.submit({
  events: myAsyncGenerator(),
});
```

### Middleware

Middleware intercepts stream events flowing through the pipeline. Each middleware can observe, transform, delay, or suppress events.

```typescript
import { createAIStore, logging, validateSchema, throttle, persist } from '@store-ai/core';
import { z } from 'zod';

const store = createAIStore({
  provider: anthropic(),
  middleware: [
    // Log all events to console
    logging({ level: 'debug' }),

    // Validate structured output against a Zod schema
    validateSchema(
      z.object({
        name: z.string(),
        age: z.number(),
        skills: z.array(z.string()),
      }),
    ),

    // Throttle state updates to 60fps
    throttle(16),

    // Persist messages to localStorage
    persist(localStorageAdapter('my-app')),
  ],
});
```

#### Writing Custom Middleware

```typescript
// Function form — simple
const myMiddleware = async (ctx, next) => {
  console.log('Before:', ctx.event.type);
  await next(); // pass to next middleware (and eventually the state reducer)
  console.log('After:', ctx.event.type);
};

// Object form — lifecycle hooks
const myMiddleware = {
  name: 'my-middleware',
  onStart({ state, store }) {
    console.log('Stream started');
  },
  onEvent: async (ctx, next) => {
    // Transform events
    if (ctx.event.type === 'text-delta') {
      ctx.event = { ...ctx.event, text: ctx.event.text.toUpperCase() };
    }
    await next();
  },
  onComplete({ state }) {
    console.log('Done! Final text:', state.text);
  },
  onError(error) {
    reportToSentry(error);
  },
};

// Filter events (don't call next() to suppress)
const noThinking = async (ctx, next) => {
  if (ctx.event.type !== 'thinking-delta') {
    await next();
  }
};

// Add middleware after creation
const unsub = store.use(myMiddleware);
// Remove it later
unsub();
```

### Structured Output

Stream and validate structured JSON responses incrementally:

```typescript
import { createAIStore, validateSchema } from '@store-ai/core';
import { z } from 'zod';

const RecipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      amount: z.string(),
    }),
  ),
  steps: z.array(z.string()),
  servings: z.number(),
});

const store = createAIStore({
  provider: openai(),
  middleware: [validateSchema(RecipeSchema)],
});

store.submit({ message: 'Give me a recipe for pasta carbonara' });

// During streaming — partial data, Zod-validated
store.subscribe('partialObject', (partial) => {
  console.log(partial);
  // { title: "Pasta Carbonara", ingredients: [{ name: "spaghetti" }] }
  // More fields appear as the stream progresses
});

// After completion — fully validated
store.subscribe('object', (obj) => {
  if (obj) {
    console.log(obj); // Full Recipe, validated against schema
  }
});
```

### Tool Calls

```typescript
store.subscribe('toolCalls', (toolCalls) => {
  for (const tc of toolCalls) {
    if (tc.status === 'complete' && !tc.output) {
      // Execute the tool
      const result = await executeTool(tc.name, tc.input);
      store.addToolResult(tc.id, result);
    }
  }
});

// Or subscribe to pending tool calls specifically
store.subscribe('pendingToolCalls', (pending) => {
  // Show loading UI for each pending tool
});
```

### Persistence

Save and restore conversations across page reloads:

```typescript
import {
  createAIStore,
  persist,
  restoreChat,
  listChats,
  deleteChat,
  localStorageAdapter,
} from '@store-ai/core';

const storage = localStorageAdapter('my-app');

// Create store with persistence
const store = createAIStore({
  middleware: [persist(storage, 'chat-1')],
});

// Restore a previous conversation on load
const saved = await restoreChat(storage, 'chat-1');
if (saved) {
  store.setMessages(saved.messages);
}

// List all saved chats
const chatIds = await listChats(storage);

// Delete a chat
await deleteChat(storage, 'old-chat');
```

Storage adapters:

```typescript
import { memoryStorage, localStorageAdapter, indexedDBAdapter } from '@store-ai/core';

memoryStorage(); // In-memory Map (testing)
localStorageAdapter('prefix'); // Browser localStorage with key prefix
indexedDBAdapter('db-name'); // Browser IndexedDB
```

### Retry on Error

```typescript
import { createAIStore, retryOn } from '@store-ai/core';

const store = createAIStore({
  middleware: [
    retryOn({
      maxRetries: 3,
      delay: 1000,
      filter: (err) => err.message.includes('rate limit'), // only retry rate limits
    }),
  ],
});
```

### Cost Tracking

```typescript
import { createAIStore, trackCost } from '@store-ai/core';

const store = createAIStore({
  middleware: [
    trackCost({
      inputCostPer1k: 0.003, // $3 / 1M input tokens
      outputCostPer1k: 0.015, // $15 / 1M output tokens
      reasoningCostPer1k: 0.015, // optional, defaults to outputCostPer1k
    }),
  ],
});

// Cost is available in middleware metadata after usage events
```

---

## Store Adapters

### Zustand

```typescript
import { toZustand } from '@store-ai/zustand';

const { store: zStore } = toZustand(aiStore);

// Use with React
import { useStore } from 'zustand';
const text = useStore(zStore, (s) => s.text);

// Use with vanilla JS
zStore.subscribe((state) => console.log(state.text));
```

### Jotai

```typescript
import { toJotai } from '@store-ai/jotai';

const { atoms } = toJotai(aiStore);

// Use individual atoms
const text = useAtomValue(atoms.text);
const status = useAtomValue(atoms.status);
const messages = useAtomValue(atoms.messages);

// Or the full state atom
const state = useAtomValue(atoms.state);
```

### Nanostores

```typescript
import { toNanostores } from '@store-ai/nanostores';

const { $state, $text, $status, $messages } = toNanostores(aiStore);

// React
import { useStore } from '@nanostores/react';
const text = useStore($text);

// Vue
import { useStore } from '@nanostores/vue';
const text = useStore($text);

// Svelte (native)
{
  $text;
}

// Solid
import { useStore } from '@nanostores/solid';
const text = useStore($text);
```

### Redux Toolkit

```typescript
import { toRedux } from '@store-ai/redux';

const { slice, startSync } = toRedux(aiStore);

// Add to your Redux store
const reduxStore = configureStore({
  reducer: { ai: slice.reducer },
});

// Start syncing
startSync(reduxStore.dispatch);

// Use selectors
const text = useSelector((s) => s.ai.text);
```

### Valtio

```typescript
import { toValtio } from '@store-ai/valtio';

const { state } = toValtio(aiStore);

// React
import { useSnapshot } from 'valtio';
const snap = useSnapshot(state);
return <p>{snap.text}</p>;
```

### @tanstack/store

```typescript
import { toTanstack } from '@store-ai/tanstack';

const { store } = toTanstack(aiStore);

// React
import { useStore } from '@tanstack/react-store';
const text = useStore(store, (s) => s.text);

// Vue
import { useStore } from '@tanstack/vue-store';
const text = useStore(store, (s) => s.text);
```

---

## API Reference

### `createAIStore(options?)`

Creates a new AI store instance.

```typescript
interface AIStoreOptions<T = unknown> {
  provider?: ProviderAdapter;
  middleware?: Middleware[];
  schema?: ZodType<T>; // structured output schema
  initialMessages?: Message[];
  batchStrategy?: 'microtask' | 'raf' | 'sync' | ((notify: () => void) => void);
}

function createAIStore<T = unknown>(options?: AIStoreOptions<T>): AIStore<T>;
```

### `store.get(key?)`

Read current state or a specific key.

```typescript
store.get(); // → full AIState
store.get('text'); // → string
store.get('status'); // → "idle" | "streaming" | ...
store.get('messages'); // → Message[]
```

### `store.subscribe(listener)` / `store.subscribe(key, listener)`

Subscribe to state changes. Returns an unsubscribe function.

```typescript
// Full state
const unsub = store.subscribe((state, prev) => { ... });

// Specific key (only fires when that key changes)
const unsub = store.subscribe('text', (text, prevText) => { ... });
```

### `store.submit(input)`

Start a new stream. Returns a `StreamHandle` with `abort()` and `signal`.

```typescript
// Simple text message
store.submit({ message: 'Hello' });

// Full conversation
store.submit({
  messages: [
    { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  ],
});

// Bring your own stream
store.submit({
  stream: response.body,
});

// With abort signal
const controller = new AbortController();
store.submit({ message: 'Hello', signal: controller.signal });
```

### `store.abort()`

Abort the active stream. State transitions to `status: "aborted"`. Accumulated text and messages are preserved.

### `store.reset()`

Reset state to initial values. Aborts any active stream.

### `store.retry()`

Re-submit the last request. Equivalent to calling `submit()` with the same input.

### `store.setMessages(messages)`

Replace the message history.

### `store.addToolResult(toolCallId, result)`

Provide a result for a pending tool call.

### `store.use(middleware)`

Add middleware at runtime. Returns unsubscribe function.

### `store.destroy()`

Clean up all subscriptions, abort active streams, release resources.

### `restoreChat(storage, chatId)`

Restore a previously persisted conversation. Returns `SerializedChat | null`.

### `listChats(storage)`

List all persisted chat IDs from a storage adapter.

### `deleteChat(storage, chatId)`

Delete a persisted conversation.

### `createPartialJSONParser<T>()`

Create an incremental JSON parser for streaming structured output. O(n) total work.

```typescript
const parser = createPartialJSONParser<MyType>();
parser.push('{"name": "Jo'); // → { name: "Jo" }
parser.push('hn", "age": 3'); // → { name: "John", age: 3 }
parser.push('0}'); // → { name: "John", age: 30 }
parser.getFinal(); // → { name: "John", age: 30 } (full validated parse)
parser.reset(); // clear state
```

### Built-in Middleware

| Middleware                                                            | Description                                                                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `logging(opts?)`                                                      | Log stream lifecycle. `level: 'debug'` logs all events; `'info'` (default) logs start/complete/error. Custom `logger`. |
| `validateSchema(schema)`                                              | Incremental Zod validation. Emits `object-delta` events for `partialObject` updates during streaming.                  |
| `throttle(ms)`                                                        | Rate-limits `text-delta` and `thinking-delta` events. Non-delta events pass through immediately. Flushes on finish.    |
| `persist(storage, chatId?)`                                           | Saves messages on completion. Use `restoreChat()` / `listChats()` / `deleteChat()` for retrieval.                      |
| `retryOn({ maxRetries, delay, filter? })`                             | Suppresses errors when retries remain, sets `_retry` metadata. Resets on success or terminal error.                    |
| `trackCost({ inputCostPer1k, outputCostPer1k, reasoningCostPer1k? })` | Calculates costs from usage events, stores `CostInfo` in `ctx.metadata.get('cost')`.                                   |
| `mapEvents(fn)`                                                       | Transform or filter events. Return `null` to suppress, return a new event to replace.                                  |

### Built-in Storage Adapters

| Adapter                        | Description             |
| ------------------------------ | ----------------------- |
| `memoryStorage()`              | In-memory (for testing) |
| `localStorageAdapter(prefix?)` | Browser localStorage    |
| `indexedDBAdapter(dbName?)`    | Browser IndexedDB       |

### Built-in Provider Adapters

| Adapter             | Format                                                  |
| ------------------- | ------------------------------------------------------- |
| `anthropic()`       | Anthropic SSE (message_start, content_block_delta, ...) |
| `openai()`          | OpenAI Chat Completions SSE                             |
| `openaiResponses()` | OpenAI Responses API SSE                                |

---

## Packages

| Package                | Description                                          | Peer Dependencies   |
| ---------------------- | ---------------------------------------------------- | ------------------- |
| `@store-ai/core`       | Core store, pipeline, middleware, providers, parsers | None                |
| `@store-ai/zustand`    | Zustand adapter                                      | `zustand >= 4`      |
| `@store-ai/jotai`      | Jotai adapter                                        | `jotai >= 2`        |
| `@store-ai/nanostores` | Nanostores adapter                                   | `nanostores >= 0.9` |
| `@store-ai/valtio`     | Valtio adapter                                       | `valtio >= 1`       |
| `@store-ai/react`      | React hooks                                          | `react >= 18`       |
| `@store-ai/vue`        | Vue composables                                      | `vue >= 3`          |
| `@store-ai/svelte`     | Svelte stores                                        | `svelte >= 4`       |
| `@store-ai/solid`      | Solid signals                                        | `solid-js >= 1`     |

---

## Comparison with Alternatives

| Feature                   | store-ai    | Vercel AI SDK | @ai-sdk-tools/store | assistant-ui  |
| ------------------------- | ----------- | ------------- | ------------------- | ------------- |
| Framework-agnostic core   | Yes         | No            | No                  | Partial       |
| Multiple store adapters   | 4 stores    | None          | Zustand only        | Internal only |
| Middleware pipeline       | Yes         | No            | No                  | No            |
| Structured output         | Yes (Zod)   | Yes           | No                  | Yes           |
| Thinking/reasoning tokens | Yes         | Yes           | Delegated           | Yes           |
| Multi-chat manager        | Planned     | No            | Partial             | Unstable      |
| Test suite                | Yes         | Yes           | None                | Some          |
| Zero dependencies (core)  | Yes         | No            | No                  | No            |
| Tool call state           | First-class | Yes           | Delegated           | Yes           |
| Custom provider support   | Yes         | Yes           | Via AI SDK          | Via adapters  |
| Persistence (middleware)  | Yes         | No            | No                  | No            |

---

## License

MIT
