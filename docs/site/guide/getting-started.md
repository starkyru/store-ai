# Getting Started

## What is store-ai?

store-ai is a framework-agnostic, store-agnostic AI stream state management library for TypeScript. It sits between your AI streaming API and your UI framework:

```
Stream (SSE/NDJSON) -> Pipeline (middleware) -> Core Store -> Store Adapter -> Framework Adapter -> UI
```

You provide the stream. store-ai manages the state. You choose your store and framework.

## Installation

Install the core package:

```bash
npm install @store-ai/core
```

Then add adapters for your stack:

```bash
# Store adapters (pick one or none)
npm install @store-ai/zustand     # if you use Zustand
npm install @store-ai/jotai       # if you use Jotai
npm install @store-ai/nanostores  # if you use Nanostores
npm install @store-ai/valtio      # if you use Valtio
npm install @store-ai/redux       # if you use Redux Toolkit
npm install @store-ai/tanstack    # if you use @tanstack/store

# Framework adapters (pick one or none)
npm install @store-ai/react       # React hooks
npm install @store-ai/vue         # Vue composables
npm install @store-ai/svelte      # Svelte stores
npm install @store-ai/solid       # Solid signals
npm install @store-ai/preact      # Preact hooks
npm install @store-ai/angular     # Angular signals
npm install @store-ai/lit         # Lit ReactiveController
```

You don't need both a store adapter and a framework adapter. Use whichever fits your architecture. The core package works on its own with vanilla `subscribe()` calls.

## Quick Start: Vanilla

Zero dependencies, no framework, no store library:

```typescript
import { createAIStore, anthropic } from '@store-ai/core';

const store = createAIStore({
  provider: anthropic(),
});

// Start streaming
store.submit({
  message: 'Explain quantum computing',
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
  console.log('Status:', status); // idle -> connecting -> streaming -> complete
});
```

## Quick Start: React + Zustand

```typescript
import { createAIStore, anthropic } from '@store-ai/core';
import { toZustand } from '@store-ai/zustand';
import { useStore } from 'zustand';

// Create once, outside components
const aiStore = createAIStore({ provider: anthropic() });
const { store: zStore } = toZustand(aiStore);

function ChatMessage() {
  const text = useStore(zStore, (s) => s.text);
  const status = useStore(zStore, (s) => s.status);

  return <div>{status === 'streaming' ? text + '...' : text}</div>;
}

function ChatInput() {
  const [input, setInput] = useState('');

  const handleSubmit = async () => {
    const message = input;
    setInput('');
    aiStore.submit({
      message,
      stream: await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      }).then((r) => r.body!),
    });
  };

  return (
    <div>
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={handleSubmit}>Send</button>
      <button onClick={() => aiStore.abort()}>Stop</button>
    </div>
  );
}
```

## Quick Start: React Hooks

If you don't need Zustand, use the built-in React hooks:

```typescript
import { createAIStore, anthropic } from '@store-ai/core';
import { useAIText, useAIStatus } from '@store-ai/react';

const store = createAIStore({ provider: anthropic() });

function StreamingText() {
  const text = useAIText(store);
  const status = useAIStatus(store);
  return <p>{status === 'streaming' ? text + '...' : text}</p>;
}
```

## Quick Start: Vue

```typescript
import { createAIStore, openai } from '@store-ai/core';
import { useAI } from '@store-ai/vue';

const store = createAIStore({ provider: openai() });

// In setup()
const { text, status, messages } = useAI(store);
```

## Quick Start: Svelte

```svelte
<script>
  import { createAIStore, openai } from '@store-ai/core';
  import { createAIReadable } from '@store-ai/svelte';

  const store = createAIStore({ provider: openai() });
  const ai = createAIReadable(store);
</script>

<p>{$ai.text}</p>
<span>Status: {$ai.status}</span>
```

## Quick Start: Solid

```typescript
import { createAIStore, anthropic } from '@store-ai/core';
import { useAI } from '@store-ai/solid';

const store = createAIStore({ provider: anthropic() });

function App() {
  const state = useAI(store);
  return <p>{state().text}</p>;
}
```

## Next Steps

- [Core Concepts](/guide/core-concepts) -- understand the state shape, provider adapters, and middleware pipeline
- [Providers](/guide/providers) -- configure Anthropic, OpenAI, or custom stream sources
- [Middleware](/guide/middleware) -- add logging, validation, persistence, and more
- [Store Adapters](/guide/store-adapters) -- connect to Zustand, Jotai, Nanostores, Valtio, Redux, or TanStack
- [Migration](/migration/from-vercel-ai-sdk) -- coming from Vercel AI SDK or `@ai-sdk-tools/store`
