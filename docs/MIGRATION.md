# Migration Guide

This guide covers migrating to store-ai from two common AI state management solutions.

## Migrating from Vercel AI SDK (`@ai-sdk/react` `useChat`)

### Overview

The Vercel AI SDK bundles HTTP fetching, state management, and React hooks into a single `useChat` hook. store-ai separates these concerns: you provide the stream, store-ai manages the state, and you choose your own store and framework bindings.

Key differences:

- **store-ai does not make HTTP requests.** You provide the `ReadableStream` (from `fetch`, a WebSocket, a file, or anywhere else). This gives you full control over authentication, routing, retries, and caching.
- **store-ai has no built-in input state management.** `useChat` manages `input` and `handleInputChange` for you. With store-ai, you manage form state yourself (or use your preferred form library).
- **store-ai is framework-agnostic.** The core works without React, Vue, or any framework.

### Before / After

**Before (Vercel AI SDK):**

```tsx
import { useChat } from '@ai-sdk/react';

function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          {m.role}: {m.content}
        </div>
      ))}
      {error && <p className="error">{error.message}</p>}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit" disabled={isLoading}>
          Send
        </button>
      </form>
    </div>
  );
}
```

**After (store-ai + React):**

```tsx
import { createAIStore, anthropic } from '@store-ai/core';
import { useAIMessages, useAIStatus, useAIError } from '@store-ai/react';
import { useState, FormEvent } from 'react';

const store = createAIStore({ provider: anthropic() });

function Chat() {
  const messages = useAIMessages(store);
  const status = useAIStatus(store);
  const error = useAIError(store);
  const [input, setInput] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setInput('');
    store.submit({
      message: input,
      stream: await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: input }),
      }).then((r) => r.body!),
    });
  };

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          {m.role}: {m.content[0]?.type === 'text' ? m.content[0].text : ''}
        </div>
      ))}
      {error && <p className="error">{error.message}</p>}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={status === 'streaming'}>
          Send
        </button>
      </form>
    </div>
  );
}
```

### Property Mapping

#### `isLoading` -> `status === 'streaming'`

Vercel AI SDK exposes a boolean `isLoading`. store-ai provides a more granular `status` field with six possible values: `'idle'`, `'connecting'`, `'streaming'`, `'complete'`, `'error'`, `'aborted'`.

```tsx
// Before
const { isLoading } = useChat();
if (isLoading) {
  /* ... */
}

// After (React hooks)
const status = useAIStatus(store);
if (status === 'streaming') {
  /* ... */
}

// Or use the convenience boolean
const isStreaming = useAIIsStreaming(store);
if (isStreaming) {
  /* ... */
}
```

#### `handleSubmit` -> `store.submit()`

Vercel AI SDK's `handleSubmit` handles form submission, message creation, and the HTTP request in one call. With store-ai, you manage the form yourself and call `store.submit()` with either a message string or a stream.

```tsx
// Before
const { handleSubmit } = useChat();
<form onSubmit={handleSubmit}>...</form>;

// After
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();
  store.submit({
    message: input,
    stream: await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: input }),
    }).then((r) => r.body!),
  });
};
```

#### `stop()` -> `store.abort()`

```tsx
// Before
const { stop } = useChat();
<button onClick={stop}>Stop</button>;

// After
<button onClick={() => store.abort()}>Stop</button>;
```

#### `reload()` -> `store.retry()`

```tsx
// Before
const { reload } = useChat();
<button onClick={reload}>Retry</button>;

// After
<button onClick={() => store.retry()}>Retry</button>;
```

#### `append` -> `store.submit({ message })`

```tsx
// Before
const { append } = useChat();
append({ role: 'user', content: 'Follow-up question' });

// After
store.submit({
  message: 'Follow-up question',
  stream: await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'Follow-up question' }),
  }).then((r) => r.body!),
});
```

#### `setMessages` -> `store.setMessages()`

```tsx
// Before
const { setMessages } = useChat();
setMessages([]);

// After
store.setMessages([]);
```

Note that store-ai uses a structured `Message` type with `content: MessageContent[]` rather than a plain `content: string`. See the [core concepts](/guide/core-concepts) for the full type definition.

### Tool Calls

**Before (Vercel AI SDK):**

```tsx
const { addToolResult } = useChat({
  maxSteps: 5,
  async onToolCall({ toolCall }) {
    if (toolCall.toolName === 'getWeather') {
      return await getWeather(toolCall.args);
    }
  },
});

// Or manually
addToolResult({ toolCallId: 'call_123', result: { temperature: 72 } });
```

**After (store-ai):**

```tsx
// Subscribe to pending tool calls
store.subscribe('pendingToolCalls', async (pending) => {
  for (const tc of pending) {
    if (tc.name === 'getWeather' && tc.status === 'complete' && !tc.output) {
      const result = await getWeather(tc.input);
      store.addToolResult(tc.id, result);
    }
  }
});

// Or in a React component
const toolCalls = useAIToolCalls(store);

useEffect(() => {
  for (const tc of toolCalls) {
    if (tc.status === 'complete' && !tc.output) {
      executeTool(tc.name, tc.input).then((result) => {
        store.addToolResult(tc.id, result);
      });
    }
  }
}, [toolCalls]);
```

### Structured Output

**Before (Vercel AI SDK `useObject`):**

```tsx
import { useObject } from '@ai-sdk/react';

const { object, isLoading } = useObject({
  api: '/api/recipe',
  schema: RecipeSchema,
});
```

**After (store-ai `validateSchema` middleware):**

```tsx
import { createAIStore, validateSchema } from '@store-ai/core';
import { useAIObject, useAIStatus } from '@store-ai/react';
import { z } from 'zod';

const RecipeSchema = z.object({
  title: z.string(),
  ingredients: z.array(z.object({ name: z.string(), amount: z.string() })),
  steps: z.array(z.string()),
});

const store = createAIStore({
  provider: openai(),
  middleware: [validateSchema(RecipeSchema)],
});

function RecipeDisplay() {
  const partial = useAIObject(store);
  const status = useAIStatus(store);

  return (
    <div>
      {partial?.title && <h1>{partial.title}</h1>}
      {partial?.ingredients?.map((ing, i) => (
        <li key={i}>
          {ing?.name}: {ing?.amount}
        </li>
      ))}
    </div>
  );
}
```

The `validateSchema` middleware incrementally parses and validates JSON during streaming, populating `partialObject` with Zod-validated partial data. On stream completion, the full result is available in `object`.

---

## Migrating from `@ai-sdk-tools/store`

### Overview

`@ai-sdk-tools/store` wraps the Vercel AI SDK with a Zustand-based store and React context provider. store-ai replaces this with a framework-agnostic core that works with any store (not just Zustand) and any framework (not just React).

Key differences:

- **No `<Provider>` wrapper needed.** store-ai stores are module-level singletons (or can be created per-component if you prefer). No React context required.
- **Direct store access.** Instead of custom hooks that read from context, you access the store directly.
- **Middleware replaces missing features.** Features like persistence, cost tracking, and retry that `@ai-sdk-tools/store` doesn't support are available as composable middleware in store-ai.

### Before / After

**Before (`@ai-sdk-tools/store`):**

```tsx
import { Provider, useChat, useChatMessages } from '@ai-sdk-tools/store';

function App() {
  return (
    <Provider>
      <Chat />
    </Provider>
  );
}

function Chat() {
  const { submit, status } = useChat();
  const messages = useChatMessages();

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.content}</div>
      ))}
      <button onClick={() => submit('Hello')}>Send</button>
      <span>{status}</span>
    </div>
  );
}
```

**After (store-ai + Zustand):**

```tsx
import { createAIStore, anthropic } from '@store-ai/core';
import { toZustand } from '@store-ai/zustand';
import { useStore } from 'zustand';

const aiStore = createAIStore({ provider: anthropic() });
const { store: zStore } = toZustand(aiStore);

// No <Provider> wrapper needed
function App() {
  return <Chat />;
}

function Chat() {
  const messages = useStore(zStore, (s) => s.messages);
  const status = useStore(zStore, (s) => s.status);

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.content[0]?.type === 'text' ? m.content[0].text : ''}</div>
      ))}
      <button
        onClick={async () => {
          aiStore.submit({
            message: 'Hello',
            stream: await fetch('/api/chat', {
              method: 'POST',
              body: JSON.stringify({ message: 'Hello' }),
            }).then((r) => r.body!),
          });
        }}
      >
        Send
      </button>
      <span>{status}</span>
    </div>
  );
}
```

**Or with store-ai React hooks (no Zustand needed):**

```tsx
import { createAIStore, anthropic } from '@store-ai/core';
import { useAIMessages, useAIStatus } from '@store-ai/react';

const store = createAIStore({ provider: anthropic() });

function Chat() {
  const messages = useAIMessages(store);
  const status = useAIStatus(store);
  // Same component code as above, using `store` instead of `aiStore`
}
```

### Hook Mapping

| `@ai-sdk-tools/store`   | store-ai (Zustand)                       | store-ai (React hooks)  |
| ----------------------- | ---------------------------------------- | ----------------------- |
| `useChatMessages()`     | `useStore(zStore, s => s.messages)`      | `useAIMessages(store)`  |
| `useChatStatus()`       | `useStore(zStore, s => s.status)`        | `useAIStatus(store)`    |
| `useChat().submit(msg)` | `aiStore.submit({ message: msg, ... })`  | `store.submit({ ... })` |
| `useChat().stop()`      | `aiStore.abort()`                        | `store.abort()`         |
| N/A (not supported)     | `useStore(zStore, s => s.error)`         | `useAIError(store)`     |
| N/A (not supported)     | `useStore(zStore, s => s.toolCalls)`     | `useAIToolCalls(store)` |
| N/A (not supported)     | `useStore(zStore, s => s.thinking)`      | `useAIThinking(store)`  |
| N/A (not supported)     | `useStore(zStore, s => s.partialObject)` | `useAIObject(store)`    |

### Features Available via Middleware

`@ai-sdk-tools/store` has no middleware system. store-ai provides these as composable middleware:

```tsx
import {
  createAIStore,
  anthropic,
  logging,
  persist,
  localStorageAdapter,
  retryOn,
  trackCost,
  throttle,
  validateSchema,
} from '@store-ai/core';

const store = createAIStore({
  provider: anthropic(),
  middleware: [
    // Debug logging (not available in @ai-sdk-tools/store)
    logging({ level: 'debug' }),

    // Persistence (not available in @ai-sdk-tools/store)
    persist(localStorageAdapter('my-app'), 'chat-1'),

    // Auto-retry on errors (not available in @ai-sdk-tools/store)
    retryOn({ maxRetries: 3, delay: 1000 }),

    // Cost tracking (not available in @ai-sdk-tools/store)
    trackCost({ inputCostPer1k: 0.003, outputCostPer1k: 0.015 }),

    // Throttle rapid updates (not available in @ai-sdk-tools/store)
    throttle(16),

    // Structured output validation (not available in @ai-sdk-tools/store)
    validateSchema(MySchema),
  ],
});
```

### Removing the Provider

The biggest structural change is removing the React context `<Provider>`. With store-ai, the store is created at the module level and imported directly wherever needed.

```tsx
// Before: Context-based
// app.tsx
import { Provider } from '@ai-sdk-tools/store';
function App() {
  return (
    <Provider>
      <Chat />
    </Provider>
  );
}

// After: Module-level store
// store.ts
import { createAIStore, anthropic } from '@store-ai/core';
export const store = createAIStore({ provider: anthropic() });

// chat.tsx
import { store } from './store';
import { useAIMessages } from '@store-ai/react';

function Chat() {
  const messages = useAIMessages(store);
  // ...
}
```

This pattern avoids the prop-drilling and context indirection that `<Provider>` introduces. If you need multiple independent chat instances, use `createChatManager()` from `@store-ai/core`.
