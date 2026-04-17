import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { toTanstack } from '../src/index.js';

// -- Helpers --

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// -- Tests --

describe('toTanstack', () => {
  it('state sync - values match after stream', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { store, destroy } = toTanstack(aiStore);

    aiStore.submit({ events: textStream(['Hello', ' ', 'world']) });
    await waitForStream();

    const state = store.state;
    expect(state.status).toBe('complete');
    expect(state.text).toBe('Hello world');
    expect(state.isStreaming).toBe(false);

    destroy();
    aiStore.destroy();
  });

  it('subscribe to store changes', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { store, destroy } = toTanstack(aiStore);

    const statuses: string[] = [];
    store.subscribe(() => {
      statuses.push(store.state.status);
    });

    aiStore.submit({ events: textStream(['hi']) });
    await waitForStream();

    expect(statuses).toContain('streaming');
    expect(statuses).toContain('complete');

    destroy();
    aiStore.destroy();
  });

  it('destroy stops syncing', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { store, destroy } = toTanstack(aiStore);

    destroy();

    aiStore.submit({ events: textStream(['after', ' ', 'destroy']) });
    await waitForStream();

    // TanStack store should still have initial state
    expect(store.state.text).toBe('');
    expect(store.state.status).toBe('idle');

    aiStore.destroy();
  });

  it('input validation throws on invalid aiStore', () => {
    expect(() => toTanstack(null as any)).toThrow(TypeError);
    expect(() => toTanstack(undefined as any)).toThrow(TypeError);
    expect(() => toTanstack({} as any)).toThrow(TypeError);
    expect(() => toTanstack({ get: 'not a function' } as any)).toThrow(TypeError);
  });

  it('multiple adapters are independent', async () => {
    const aiStore = createAIStore({ batchStrategy: 'sync' });
    const { store: store1, destroy: destroy1 } = toTanstack(aiStore);
    const { store: store2, destroy: destroy2 } = toTanstack(aiStore);

    aiStore.submit({ events: textStream(['shared']) });
    await waitForStream();

    expect(store1.state.text).toBe('shared');
    expect(store2.state.text).toBe('shared');

    // Destroy one, the other still works
    destroy1();

    aiStore.reset();
    aiStore.submit({ events: textStream(['only-two']) });
    await waitForStream();

    // store1 is stale
    expect(store1.state.text).toBe('shared');
    // store2 still receives updates
    expect(store2.state.text).toBe('only-two');

    destroy2();
    aiStore.destroy();
  });
});
