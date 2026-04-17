# Migrating from @ai-sdk-tools/store

This guide covers migrating from `@ai-sdk-tools/store` to store-ai.

## Overview

`@ai-sdk-tools/store` wraps the Vercel AI SDK with a Zustand-based store and React context provider. store-ai replaces this with a framework-agnostic core that works with any store (not just Zustand) and any framework (not just React).

Key differences:

- **No `<Provider>` wrapper needed.** store-ai stores are module-level singletons (or can be created per-component if you prefer). No React context required.
- **Direct store access.** Instead of custom hooks that read from context, you access the store directly.
- **Middleware replaces missing features.** Features like persistence, cost tracking, and retry that `@ai-sdk-tools/store` doesn't support are available as composable middleware.

## Before / After

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

**Or with store-ai React hooks (no Zustand):**

```tsx
import { createAIStore, anthropic } from '@store-ai/core';
import { useAIMessages, useAIStatus } from '@store-ai/react';

const store = createAIStore({ provider: anthropic() });

function Chat() {
  const messages = useAIMessages(store);
  const status = useAIStatus(store);

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.content[0]?.type === 'text' ? m.content[0].text : ''}</div>
      ))}
      <button
        onClick={async () => {
          store.submit({
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

## Hook Mapping

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

## Removing the Provider

The biggest structural change is removing the React context `<Provider>`. With store-ai, the store is created at the module level and imported directly wherever needed.

**Before:**

```tsx
// app.tsx
import { Provider } from '@ai-sdk-tools/store';

function App() {
  return (
    <Provider>
      <Chat />
    </Provider>
  );
}
```

**After:**

```tsx
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

## Features Available via Middleware

`@ai-sdk-tools/store` has no middleware system. store-ai provides these capabilities as composable middleware:

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
import { z } from 'zod';

const store = createAIStore({
  provider: anthropic(),
  middleware: [
    // Debug logging
    logging({ level: 'debug' }),

    // Persist conversations to localStorage
    persist(localStorageAdapter('my-app'), 'chat-1'),

    // Auto-retry on transient errors
    retryOn({ maxRetries: 3, delay: 1000 }),

    // Token cost tracking
    trackCost({ inputCostPer1k: 0.003, outputCostPer1k: 0.015 }),

    // Rate-limit UI updates to 60fps
    throttle(16),

    // Incremental Zod schema validation for structured output
    validateSchema(
      z.object({
        summary: z.string(),
        items: z.array(z.string()),
      }),
    ),
  ],
});
```

None of these features are available in `@ai-sdk-tools/store`. With store-ai, you compose exactly the features you need.

## Using a Different Store

With `@ai-sdk-tools/store`, you're locked to Zustand. store-ai supports six store libraries out of the box:

```tsx
// Zustand
import { toZustand } from '@store-ai/zustand';
const { store: zStore } = toZustand(aiStore);

// Jotai
import { toJotai } from '@store-ai/jotai';
const { atoms } = toJotai(aiStore);

// Nanostores
import { toNanostores } from '@store-ai/nanostores';
const { $text, $status } = toNanostores(aiStore);

// Valtio
import { toValtio } from '@store-ai/valtio';
const { state } = toValtio(aiStore);

// Redux Toolkit
import { toRedux } from '@store-ai/redux';
const { slice, startSync } = toRedux(aiStore);

// @tanstack/store
import { toTanstack } from '@store-ai/tanstack';
const { store } = toTanstack(aiStore);
```

Or skip store adapters entirely and use the vanilla core with `subscribe()` or the framework-specific hooks (`@store-ai/react`, `@store-ai/vue`, `@store-ai/svelte`, `@store-ai/solid`).
