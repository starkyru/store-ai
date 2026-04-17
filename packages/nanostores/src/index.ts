import type { AIStore, AIFullState, StoreAdapterResult } from '@store-ai/core';
import { atom, computed, type ReadableAtom } from 'nanostores';

export interface NanostoreAtoms<T = unknown> {
  $state: ReadableAtom<AIFullState<T>>;
  $text: ReadableAtom<string>;
  $status: ReadableAtom<AIFullState<T>['status']>;
  $messages: ReadableAtom<AIFullState<T>['messages']>;
  $toolCalls: ReadableAtom<AIFullState<T>['toolCalls']>;
  $thinking: ReadableAtom<string>;
  $error: ReadableAtom<Error | null>;
  $isStreaming: ReadableAtom<boolean>;
  $partialObject: ReadableAtom<AIFullState<T>['partialObject']>;
  $object: ReadableAtom<AIFullState<T>['object']>;
  $usage: ReadableAtom<AIFullState<T>['usage']>;
}

export function toNanostores<T = unknown>(
  aiStore: AIStore<T>,
): StoreAdapterResult<NanostoreAtoms<T>> {
  if (!aiStore || typeof aiStore.get !== 'function' || typeof aiStore.subscribe !== 'function') {
    throw new TypeError('toNanostores() requires a valid AIStore instance');
  }

  let destroyed = false;
  const $state = atom<AIFullState<T>>(aiStore.get());

  const unsub = aiStore.subscribe((state) => {
    if (destroyed) return;
    $state.set(state);
  });

  const store: NanostoreAtoms<T> = {
    $state,
    $text: computed($state, (s) => s.text),
    $status: computed($state, (s) => s.status),
    $messages: computed($state, (s) => s.messages),
    $toolCalls: computed($state, (s) => s.toolCalls),
    $thinking: computed($state, (s) => s.thinking),
    $error: computed($state, (s) => s.error),
    $isStreaming: computed($state, (s) => s.isStreaming),
    $partialObject: computed($state, (s) => s.partialObject),
    $object: computed($state, (s) => s.object),
    $usage: computed($state, (s) => s.usage),
  };

  return {
    store,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsub();
    },
  };
}
