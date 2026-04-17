import {
  signal,
  computed,
  type Signal,
  type WritableSignal,
  DestroyRef,
  inject,
} from '@angular/core';
import type { AIStore, AIFullState, Message, ToolCallState, DeepPartial } from '@store-ai/core';

export interface UseAIReturn<T = unknown> {
  state: Signal<AIFullState<T>>;
  text: Signal<string>;
  status: Signal<AIFullState<T>['status']>;
  messages: Signal<Message[]>;
  toolCalls: Signal<ToolCallState[]>;
  thinking: Signal<string>;
  error: Signal<Error | null>;
  isStreaming: Signal<boolean>;
  partialObject: Signal<DeepPartial<T> | null>;
  object: Signal<T | null>;
}

/**
 * Creates Angular signals from an AIStore.
 * Must be called within an injection context (component, directive, service constructor).
 * Automatically cleans up on destroy.
 */
export function useAI<T = unknown>(store: AIStore<T>): UseAIReturn<T> {
  const stateSignal: WritableSignal<AIFullState<T>> = signal(store.get());

  const unsub = store.subscribe((s) => {
    stateSignal.set(s);
  });

  // Auto-cleanup when the component/service is destroyed
  const destroyRef = inject(DestroyRef);
  destroyRef.onDestroy(unsub);

  return {
    state: stateSignal,
    text: computed(() => stateSignal().text),
    status: computed(() => stateSignal().status),
    messages: computed(() => stateSignal().messages),
    toolCalls: computed(() => stateSignal().toolCalls),
    thinking: computed(() => stateSignal().thinking),
    error: computed(() => stateSignal().error),
    isStreaming: computed(() => stateSignal().isStreaming),
    partialObject: computed(() => stateSignal().partialObject),
    object: computed(() => stateSignal().object),
  };
}

/**
 * Creates an RxJS-compatible Observable from an AIStore for use with the async pipe.
 * Does NOT require an injection context.
 */
export function toObservable<T, S>(
  store: AIStore<T>,
  selector: (state: AIFullState<T>) => S,
): { subscribe: (observer: { next: (value: S) => void }) => { unsubscribe: () => void } } {
  return {
    subscribe(observer: { next: (value: S) => void }) {
      observer.next(selector(store.get()));
      const unsub = store.subscribe((state) => {
        observer.next(selector(state));
      });
      return { unsubscribe: unsub };
    },
  };
}
