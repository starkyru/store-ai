# Framework Adapters API

Full API reference for framework adapter packages.

## `@store-ai/react`

### `useAIStore(store, selector)`

Generic selector hook. Uses `useSyncExternalStore` for tear-free reads.

```typescript
function useAIStore<T, S>(store: AIStore<T>, selector: (state: AIFullState<T>) => S): S;
```

### `useAIText(store)`

Returns the accumulated response text.

```typescript
function useAIText(store: AIStore): string;
```

### `useAIStatus(store)`

Returns the current stream status.

```typescript
function useAIStatus(store: AIStore): AIStatus;
// 'idle' | 'connecting' | 'streaming' | 'complete' | 'error' | 'aborted'
```

### `useAIMessages(store)`

Returns the full conversation message array.

```typescript
function useAIMessages(store: AIStore): Message[];
```

### `useAIToolCalls(store)`

Returns all tool call states.

```typescript
function useAIToolCalls(store: AIStore): ToolCallState[];
```

### `useAIObject<T>(store)`

Returns the incrementally parsed partial object (from `validateSchema` middleware).

```typescript
function useAIObject<T>(store: AIStore<T>): DeepPartial<T> | null;
```

### `useAIThinking(store)`

Returns the accumulated thinking/reasoning text.

```typescript
function useAIThinking(store: AIStore): string;
```

### `useAIIsStreaming(store)`

Returns whether a stream is currently active.

```typescript
function useAIIsStreaming(store: AIStore): boolean;
```

### `useAIError(store)`

Returns the current error, or null.

```typescript
function useAIError(store: AIStore): Error | null;
```

## `@store-ai/vue`

### `useAI(store)`

Returns reactive refs and computed properties. Automatically cleans up on scope disposal.

```typescript
function useAI<T>(store: AIStore<T>): {
  state: Readonly<Ref<AIFullState<T>>>;
  text: ComputedRef<string>;
  status: ComputedRef<AIStatus>;
  messages: ComputedRef<Message[]>;
  // ...
};
```

## `@store-ai/svelte`

### `createAIReadable(store)`

Returns a typed Svelte `Readable` store with derived stores for individual fields.

```typescript
function createAIReadable<T>(store: AIStore<T>): Readable<AIFullState<T>> & {
  text: Readable<string>;
  status: Readable<AIStatus>;
  messages: Readable<Message[]>;
};
```

## `@store-ai/solid`

### `useAI(store)`

Returns a Solid signal containing the full state. Cleans up with `onCleanup`.

```typescript
function useAI<T>(store: AIStore<T>): Accessor<AIFullState<T>>;
```
