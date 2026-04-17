import { createSignal, onCleanup } from 'solid-js';
import type { AIStore, AIFullState, Message, ToolCallState, DeepPartial } from '@store-ai/core';

export interface UseAIReturn<T = unknown> {
  state: () => AIFullState<T>;
  text: () => string;
  status: () => AIFullState<T>['status'];
  messages: () => Message[];
  toolCalls: () => ToolCallState[];
  thinking: () => string;
  error: () => Error | null;
  isStreaming: () => boolean;
  partialObject: () => DeepPartial<T> | null;
  object: () => T | null;
}

/**
 * Creates reactive Solid accessors from an AIStore.
 *
 * Must be called within a reactive scope (component body, `createRoot`, etc.)
 * so that `onCleanup` can automatically unsubscribe when the scope is disposed.
 */
export function useAI<T = unknown>(store: AIStore<T>): UseAIReturn<T> {
  const [state, setState] = createSignal<AIFullState<T>>(store.get());

  const unsub = store.subscribe((s) => setState(() => s));
  onCleanup(unsub);

  return {
    state,
    text: () => state().text,
    status: () => state().status,
    messages: () => state().messages,
    toolCalls: () => state().toolCalls,
    thinking: () => state().thinking,
    error: () => state().error,
    isStreaming: () => state().isStreaming,
    partialObject: () => state().partialObject,
    object: () => state().object,
  };
}
