import { useState, useEffect, useRef } from 'preact/hooks';
import type { AIStore, AIFullState, Message, ToolCallState, DeepPartial } from '@store-ai/core';

export function useAIStore<T, S>(store: AIStore<T>, selector: (state: AIFullState<T>) => S): S {
  const [value, setValue] = useState(() => selector(store.get()));
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  useEffect(() => {
    // Sync in case state changed between render and effect
    setValue(selectorRef.current(store.get()));
    return store.subscribe((state) => {
      setValue(selectorRef.current(state));
    });
  }, [store]);

  return value;
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
