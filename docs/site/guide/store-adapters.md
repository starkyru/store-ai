# Store Adapters

Store adapters project the core `AIStore`'s reactive state into a specific state management library's primitives. Each adapter is a thin wrapper (typically under 50 lines of code) with the target library as a peer dependency.

## Available Adapters

| Package                | Target Library  | Peer Dependency     |
| ---------------------- | --------------- | ------------------- |
| `@store-ai/zustand`    | Zustand         | `zustand >= 4`      |
| `@store-ai/jotai`      | Jotai           | `jotai >= 2`        |
| `@store-ai/nanostores` | Nanostores      | `nanostores >= 0.9` |
| `@store-ai/valtio`     | Valtio          | `valtio >= 1`       |
| `@store-ai/redux`      | Redux Toolkit   | `@reduxjs/toolkit`  |
| `@store-ai/tanstack`   | @tanstack/store | `@tanstack/store`   |

## Zustand

```typescript
import { createAIStore, anthropic } from '@store-ai/core';
import { toZustand } from '@store-ai/zustand';
import { useStore } from 'zustand';

const aiStore = createAIStore({ provider: anthropic() });
const { store: zStore } = toZustand(aiStore);

// React
const text = useStore(zStore, (s) => s.text);

// Vanilla
zStore.subscribe((state) => console.log(state.text));
```

## Jotai

```typescript
import { toJotai } from '@store-ai/jotai';
import { useAtomValue } from 'jotai';

const { atoms } = toJotai(aiStore);

const text = useAtomValue(atoms.text);
const status = useAtomValue(atoms.status);
const messages = useAtomValue(atoms.messages);
```

## Nanostores

```typescript
import { toNanostores } from '@store-ai/nanostores';

const { $state, $text, $status, $messages } = toNanostores(aiStore);

// Works with React, Vue, Svelte, Solid, Lit, and Angular
// via their respective @nanostores/* bindings
```

## Valtio

```typescript
import { toValtio } from '@store-ai/valtio';
import { useSnapshot } from 'valtio';

const { state } = toValtio(aiStore);

// React
const snap = useSnapshot(state);
return <p>{snap.text}</p>;
```

## Redux Toolkit

```typescript
import { toRedux } from '@store-ai/redux';
import { configureStore } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';

const { slice, startSync } = toRedux(aiStore);

const reduxStore = configureStore({
  reducer: { ai: slice.reducer },
});

startSync(reduxStore.dispatch);

// React
const text = useSelector((s) => s.ai.text);
```

## @tanstack/store

```typescript
import { toTanstack } from '@store-ai/tanstack';
import { useStore } from '@tanstack/react-store';

const { store } = toTanstack(aiStore);

// React
const text = useStore(store, (s) => s.text);

// Vue
import { useStore } from '@tanstack/vue-store';
const text = useStore(store, (s) => s.text);
```

## When to Use Store Adapters vs Framework Adapters

- **Store adapters** are for when you already use a specific state management library and want AI state to live in the same store.
- **Framework adapters** (`@store-ai/react`, `@store-ai/vue`, etc.) are for when you just need reactive hooks without adding a store library.

Both approaches work. You can also combine them (e.g., use Zustand for some state and the React hooks for quick prototyping).
