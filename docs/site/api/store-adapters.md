# Store Adapters API

Full API reference for store adapter packages.

## Common Interface

Every store adapter returns:

```typescript
interface StoreAdapterResult<TStore> {
  store: TStore;
  destroy(): void;
}
```

Call `destroy()` to clean up the subscription between the core `AIStore` and the adapter's store.

## `toZustand(aiStore)` -- `@store-ai/zustand`

```typescript
import { toZustand } from '@store-ai/zustand';

const { store, destroy } = toZustand(aiStore);
// store: StoreApi<AIFullState>
```

Returns a Zustand vanilla store. Use with `useStore` from `zustand` in React.

## `toJotai(aiStore)` -- `@store-ai/jotai`

```typescript
import { toJotai } from '@store-ai/jotai';

const { atoms, destroy } = toJotai(aiStore);
// atoms.state: Atom<AIFullState>
// atoms.text: Atom<string>
// atoms.status: Atom<AIStatus>
// atoms.messages: Atom<Message[]>
```

Returns individual atoms for each state key, plus a `state` atom for the full state.

## `toNanostores(aiStore)` -- `@store-ai/nanostores`

```typescript
import { toNanostores } from '@store-ai/nanostores';

const { $state, $text, $status, $messages, destroy } = toNanostores(aiStore);
```

Returns Nanostores `map` and derived atoms. Works with `@nanostores/react`, `@nanostores/vue`, Svelte's native `$store`, and `@nanostores/solid`.

## `toValtio(aiStore)` -- `@store-ai/valtio`

```typescript
import { toValtio } from '@store-ai/valtio';

const { state, destroy } = toValtio(aiStore);
// state: proxy(AIFullState)
```

Returns a Valtio proxy. Use with `useSnapshot` in React.

## `toRedux(aiStore)` -- `@store-ai/redux`

```typescript
import { toRedux } from '@store-ai/redux';

const { slice, startSync } = toRedux(aiStore);
// slice: Slice (add to your Redux store)
// startSync(dispatch): () => void (returns unsub)
```

Returns a Redux Toolkit slice. Call `startSync(store.dispatch)` to begin syncing.

## `toTanstack(aiStore)` -- `@store-ai/tanstack`

```typescript
import { toTanstack } from '@store-ai/tanstack';

const { store, destroy } = toTanstack(aiStore);
// store: Store<AIFullState>
```

Returns a `@tanstack/store` Store instance. Use with `useStore` from `@tanstack/react-store` or `@tanstack/vue-store`.
