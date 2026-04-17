# Migrating from Vercel AI SDK

This guide covers migrating from `@ai-sdk/react`'s `useChat` hook to store-ai.

## Overview

The Vercel AI SDK bundles HTTP fetching, state management, and React hooks into a single `useChat` hook. store-ai separates these concerns: you provide the stream, store-ai manages the state, and you choose your own store and framework bindings.

Key differences:

- **store-ai does not make HTTP requests.** You provide the `ReadableStream` (from `fetch`, a WebSocket, a file, or anywhere else). This gives you full control over authentication, routing, retries, and caching.
- **store-ai has no built-in input state management.** `useChat` manages `input` and `handleInputChange` for you. With store-ai, you manage form state yourself (or use your preferred form library).
- **store-ai is framework-agnostic.** The core works without React, Vue, or any framework.

## Before / After

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

## Property Mapping

### `isLoading` -> `status === 'streaming'`

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
```

### `handleSubmit` -> `store.submit()`

Vercel AI SDK's `handleSubmit` handles form submission, message creation, and the HTTP request in one call. With store-ai, you manage the form yourself and call `store.submit()`.

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

### `stop()` -> `store.abort()`

```tsx
// Before
const { stop } = useChat();
<button onClick={stop}>Stop</button>;

// After
<button onClick={() => store.abort()}>Stop</button>;
```

### `reload()` -> `store.retry()`

```tsx
// Before
const { reload } = useChat();
<button onClick={reload}>Retry</button>;

// After
<button onClick={() => store.retry()}>Retry</button>;
```

### `append` -> `store.submit({ message })`

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

### `setMessages` -> `store.setMessages()`

```tsx
// Before
const { setMessages } = useChat();
setMessages([]);

// After
store.setMessages([]);
```

Note that store-ai uses a structured `Message` type with `content: MessageContent[]` rather than a plain `content: string`. See the [core concepts guide](/guide/core-concepts) for the full type definition.

## Tool Calls

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

## Structured Output

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
import { createAIStore, validateSchema, openai } from '@store-ai/core';
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

The `validateSchema` middleware incrementally parses and validates JSON during streaming, populating `partialObject` with Zod-validated partial data. On stream completion, the full result is available via `store.get('object')`.

## Summary of Differences

| Concern           | Vercel AI SDK                         | store-ai                                                    |
| ----------------- | ------------------------------------- | ----------------------------------------------------------- |
| HTTP requests     | Built-in (`api` option)               | You provide the stream                                      |
| Input state       | `input` + `handleInputChange`         | Manage with `useState` or your form library                 |
| Loading state     | `isLoading` boolean                   | `status` enum with 6 values                                 |
| Framework support | React, Vue, Svelte (separate imports) | Any framework via adapters, or vanilla                      |
| Store integration | Internal, not accessible              | Zustand, Jotai, Nanostores, Valtio, Redux, TanStack         |
| Middleware        | None                                  | Composable pipeline (logging, persistence, retry, cost ...) |
| Structured output | `useObject` hook                      | `validateSchema` middleware                                 |
| Persistence       | Not built-in                          | `persist` middleware + storage adapters                     |
| Cost tracking     | Not built-in                          | `trackCost` middleware                                      |
