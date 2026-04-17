import type { AIStore, AIFullState, Message, ToolCallState, DeepPartial } from '@store-ai/core';

/** Svelte-compatible readable store interface */
export interface SvelteReadable<T> {
  subscribe(run: (value: T) => void): () => void;
}

/** Creates a Svelte-compatible readable store from an AIStore with a selector */
function toReadable<T, S>(
  store: AIStore<T>,
  selector: (state: AIFullState<T>) => S,
): SvelteReadable<S> {
  return {
    subscribe(run: (value: S) => void) {
      // Emit current value immediately (Svelte store contract)
      run(selector(store.get()));
      // Subscribe to future changes
      return store.subscribe((state) => {
        run(selector(state));
      });
    },
  };
}

export interface AIReadableStores<T = unknown> {
  state: SvelteReadable<AIFullState<T>>;
  text: SvelteReadable<string>;
  status: SvelteReadable<AIFullState<T>['status']>;
  messages: SvelteReadable<Message[]>;
  toolCalls: SvelteReadable<ToolCallState[]>;
  thinking: SvelteReadable<string>;
  error: SvelteReadable<Error | null>;
  isStreaming: SvelteReadable<boolean>;
  partialObject: SvelteReadable<DeepPartial<T> | null>;
  object: SvelteReadable<T | null>;
}

/**
 * Creates a set of Svelte-compatible readable stores from an AIStore.
 *
 * Each returned property is a Svelte store (has `.subscribe()`) that can
 * be used with Svelte's `$store` syntax or `get()` from `svelte/store`.
 */
export function createAIReadable<T = unknown>(store: AIStore<T>): AIReadableStores<T> {
  return {
    state: toReadable(store, (s) => s),
    text: toReadable(store, (s) => s.text),
    status: toReadable(store, (s) => s.status),
    messages: toReadable(store, (s) => s.messages),
    toolCalls: toReadable(store, (s) => s.toolCalls),
    thinking: toReadable(store, (s) => s.thinking),
    error: toReadable(store, (s) => s.error),
    isStreaming: toReadable(store, (s) => s.isStreaming),
    partialObject: toReadable(store, (s) => s.partialObject),
    object: toReadable(store, (s) => s.object),
  };
}
