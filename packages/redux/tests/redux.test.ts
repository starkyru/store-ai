import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { toRedux } from '../src/index.js';

// AI state contains Date objects, so disable the serializable check middleware in tests.
function createTestStore(slice: ReturnType<typeof toRedux>['slice']) {
  return configureStore({
    reducer: { ai: slice.reducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
}

// -- Helpers --

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// -- Tests --

describe('toRedux', () => {
  it('creates slice with correct initial state', () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { slice } = toRedux(aiStore);

    const store = createTestStore(slice);
    const state = store.getState().ai;

    expect(state.status).toBe('idle');
    expect(state.text).toBe('');
    expect(state.messages).toEqual([]);
    expect(state.isIdle).toBe(true);
    expect(state.isStreaming).toBe(false);

    aiStore.destroy();
  });

  it('startSync dispatches on AI state changes', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { slice, startSync } = toRedux(aiStore);

    const store = createTestStore(slice);
    const unsub = startSync(store.dispatch);

    aiStore.submit({ events: textStream(['Hello', ' ', 'world']) });
    await waitForStream();

    const state = store.getState().ai;
    expect(state.status).toBe('complete');
    expect(state.text).toBe('Hello world');

    unsub();
    aiStore.destroy();
  });

  it('selector reads work after sync', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { slice, startSync } = toRedux(aiStore);

    const store = createTestStore(slice);
    const unsub = startSync(store.dispatch);

    aiStore.submit({ events: textStream(['foo', 'bar']) });
    await waitForStream();

    expect(store.getState().ai.text).toBe('foobar');
    expect(store.getState().ai.isStreaming).toBe(false);
    expect(store.getState().ai.hasMessages).toBe(true);

    unsub();
    aiStore.destroy();
  });

  it('unsubscribe stops dispatching', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { slice, startSync } = toRedux(aiStore);

    const store = createTestStore(slice);
    const unsub = startSync(store.dispatch);

    // Unsubscribe before any stream
    unsub();

    aiStore.submit({ events: textStream(['after', ' ', 'unsub']) });
    await waitForStream();

    // Redux store should still have initial state
    expect(store.getState().ai.text).toBe('');
    expect(store.getState().ai.status).toBe('idle');

    aiStore.destroy();
  });

  it('input validation throws on invalid aiStore', () => {
    expect(() => toRedux(null as any)).toThrow(TypeError);
    expect(() => toRedux(undefined as any)).toThrow(TypeError);
    expect(() => toRedux({} as any)).toThrow(TypeError);
    expect(() => toRedux({ get: 'not a function' } as any)).toThrow(TypeError);
  });
});
