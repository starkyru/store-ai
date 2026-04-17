# Framework Adapters

Framework adapters provide idiomatic hooks, composables, or stores for each UI framework. They wrap the core `AIStore` directly -- no store adapter needed.

## React

```bash
npm install @store-ai/react
```

```typescript
import { createAIStore, anthropic } from '@store-ai/core';
import {
  useAIStore,
  useAIText,
  useAIStatus,
  useAIMessages,
  useAIToolCalls,
  useAIObject,
  useAIThinking,
  useAIIsStreaming,
  useAIError,
} from '@store-ai/react';

const store = createAIStore({ provider: anthropic() });

function Chat() {
  const text = useAIText(store);
  const status = useAIStatus(store);
  const messages = useAIMessages(store);
  const error = useAIError(store);

  // Custom selector
  const messageCount = useAIStore(store, (s) => s.messages.length);

  return <div>{text}</div>;
}
```

All hooks use `useSyncExternalStore` for tear-free concurrent mode support. Components only re-render when their selected state changes.

### Available Hooks

| Hook               | Returns                  |
| ------------------ | ------------------------ |
| `useAIStore(s, f)` | Custom selector result   |
| `useAIText`        | `string`                 |
| `useAIStatus`      | `AIStatus`               |
| `useAIMessages`    | `Message[]`              |
| `useAIToolCalls`   | `ToolCallState[]`        |
| `useAIObject<T>`   | `DeepPartial<T> \| null` |
| `useAIThinking`    | `string`                 |
| `useAIIsStreaming` | `boolean`                |
| `useAIError`       | `Error \| null`          |

## Vue

```bash
npm install @store-ai/vue
```

```typescript
import { createAIStore, openai } from '@store-ai/core';
import { useAI } from '@store-ai/vue';

const store = createAIStore({ provider: openai() });

// In setup()
const { text, status, messages, state } = useAI(store);
```

Returns Vue `Ref` and `computed` properties. Automatically cleans up on scope disposal.

## Svelte

```bash
npm install @store-ai/svelte
```

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

Returns Svelte `Readable` stores with typed derived stores for individual fields (`ai.text`, `ai.status`, etc.).

## Solid

```bash
npm install @store-ai/solid
```

```typescript
import { createAIStore, anthropic } from '@store-ai/core';
import { useAI } from '@store-ai/solid';

const store = createAIStore({ provider: anthropic() });

function App() {
  const state = useAI(store);
  return <p>{state().text}</p>;
}
```

Returns a Solid signal. Automatically cleans up with `onCleanup`.
