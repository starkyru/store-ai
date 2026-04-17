import type { AIStore, AIFullState, StoreAdapterResult } from '@store-ai/core';
import { atom, createStore, type Atom } from 'jotai/vanilla';

export interface JotaiAtoms<T = unknown> {
  state: Atom<AIFullState<T>>;
  text: Atom<string>;
  status: Atom<AIFullState<T>['status']>;
  messages: Atom<AIFullState<T>['messages']>;
  toolCalls: Atom<AIFullState<T>['toolCalls']>;
  thinking: Atom<string>;
  error: Atom<Error | null>;
  isStreaming: Atom<boolean>;
  partialObject: Atom<AIFullState<T>['partialObject']>;
  object: Atom<AIFullState<T>['object']>;
  usage: Atom<AIFullState<T>['usage']>;
}

export function toJotai<T = unknown>(
  aiStore: AIStore<T>,
): StoreAdapterResult<JotaiAtoms<T>> & { jotaiStore: ReturnType<typeof createStore> } {
  if (!aiStore || typeof aiStore.get !== 'function' || typeof aiStore.subscribe !== 'function') {
    throw new TypeError('toJotai() requires a valid AIStore instance');
  }

  let destroyed = false;
  const jStore = createStore();
  const stateAtom = atom<AIFullState<T>>(aiStore.get());

  const unsub = aiStore.subscribe((state) => {
    if (destroyed) return;
    jStore.set(stateAtom, state);
  });

  const atoms: JotaiAtoms<T> = {
    state: stateAtom,
    text: atom((get) => get(stateAtom).text),
    status: atom((get) => get(stateAtom).status),
    messages: atom((get) => get(stateAtom).messages),
    toolCalls: atom((get) => get(stateAtom).toolCalls),
    thinking: atom((get) => get(stateAtom).thinking),
    error: atom((get) => get(stateAtom).error),
    isStreaming: atom((get) => get(stateAtom).isStreaming),
    partialObject: atom((get) => get(stateAtom).partialObject),
    object: atom((get) => get(stateAtom).object),
    usage: atom((get) => get(stateAtom).usage),
  };

  return {
    store: atoms,
    jotaiStore: jStore,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsub();
    },
  };
}
