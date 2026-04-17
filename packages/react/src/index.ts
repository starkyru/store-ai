import { useSyncExternalStore, useCallback } from 'react';
import type { AIStore, AIFullState, Message, ToolCallState, DeepPartial } from '@store-ai/core';

export function useAIStore<T, S>(store: AIStore<T>, selector: (state: AIFullState<T>) => S): S {
  return useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    () => selector(store.get()),
    () => selector(store.get()), // server snapshot same as client
  );
}

export function useAIText(store: AIStore): string {
  return useAIStore(store, (s) => s.text);
}

export function useAIStatus(store: AIStore): AIFullState['status'] {
  return useAIStore(store, (s) => s.status);
}

export function useAIMessages(store: AIStore): Message[] {
  return useAIStore(store, (s) => s.messages);
}

export function useAIToolCalls(store: AIStore): ToolCallState[] {
  return useAIStore(store, (s) => s.toolCalls);
}

export function useAIObject<T>(store: AIStore<T>): DeepPartial<T> | null {
  return useAIStore(store, (s) => s.partialObject);
}

export function useAIThinking(store: AIStore): string {
  return useAIStore(store, (s) => s.thinking);
}

export function useAIIsStreaming(store: AIStore): boolean {
  return useAIStore(store, (s) => s.isStreaming);
}

export function useAIError(store: AIStore): Error | null {
  return useAIStore(store, (s) => s.error);
}
