import type { AIStore, AIFullState } from '@store-ai/core';
import { createSlice, type PayloadAction, type Slice, type Dispatch } from '@reduxjs/toolkit';

export interface ReduxAdapterResult<T = unknown> {
  /** Redux slice with a `sync` action that replaces the full AI state. */
  slice: Slice<AIFullState<T>>;
  /**
   * Call this with your Redux dispatch to start syncing.
   * Returns an unsubscribe function.
   */
  startSync(dispatch: Dispatch): () => void;
}

export function toRedux<T = unknown>(aiStore: AIStore<T>): ReduxAdapterResult<T> {
  if (!aiStore || typeof aiStore.get !== 'function' || typeof aiStore.subscribe !== 'function') {
    throw new TypeError('toRedux() requires a valid AIStore instance');
  }

  const slice = createSlice({
    name: 'ai',
    initialState: aiStore.get(),
    reducers: {
      sync: (_state, action: PayloadAction<AIFullState<T>>) => action.payload,
    },
  });

  let destroyed = false;

  function startSync(dispatch: Dispatch): () => void {
    const unsub = aiStore.subscribe((state) => {
      if (destroyed) return;
      dispatch(slice.actions.sync(state));
    });

    return () => {
      if (destroyed) return;
      destroyed = true;
      unsub();
    };
  }

  return { slice, startSync };
}
