import { shallowRef, computed, onScopeDispose, type Ref, type ComputedRef } from 'vue';
import type { AIStore, AIFullState, Message, ToolCallState, DeepPartial } from '@store-ai/core';

export interface UseAIReturn<T = unknown> {
  state: Ref<AIFullState<T>>;
  text: ComputedRef<string>;
  status: ComputedRef<AIFullState<T>['status']>;
  messages: ComputedRef<Message[]>;
  toolCalls: ComputedRef<ToolCallState[]>;
  thinking: ComputedRef<string>;
  error: ComputedRef<Error | null>;
  isStreaming: ComputedRef<boolean>;
  partialObject: ComputedRef<DeepPartial<T> | null>;
  object: ComputedRef<T | null>;
}

export function useAI<T = unknown>(store: AIStore<T>): UseAIReturn<T> {
  const state = shallowRef<AIFullState<T>>(store.get());

  const unsub = store.subscribe((s) => {
    state.value = s;
  });

  onScopeDispose(unsub);

  return {
    state,
    text: computed(() => state.value.text),
    status: computed(() => state.value.status),
    messages: computed(() => state.value.messages),
    toolCalls: computed(() => state.value.toolCalls),
    thinking: computed(() => state.value.thinking),
    error: computed(() => state.value.error),
    isStreaming: computed(() => state.value.isStreaming),
    partialObject: computed(() => state.value.partialObject),
    object: computed(() => state.value.object),
  };
}
