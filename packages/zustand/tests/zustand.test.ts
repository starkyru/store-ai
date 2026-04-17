import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { toZustand } from '../src/index.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('toZustand', () => {
  describe('state sync', () => {
    it('zustand store has initial state matching AIStore', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore, destroy } = toZustand(aiStore);

      const state = zStore.getState();
      expect(state.status).toBe('idle');
      expect(state.text).toBe('');
      expect(state.messages).toEqual([]);
      expect(state.isIdle).toBe(true);
      expect(state.isStreaming).toBe(false);

      destroy();
      aiStore.destroy();
    });

    it('zustand store reflects state after stream events', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore, destroy } = toZustand(aiStore);

      aiStore.submit({ events: textStream(['Hello', ' ', 'world']) });
      await waitForStream();

      const state = zStore.getState();
      expect(state.status).toBe('complete');
      expect(state.text).toBe('Hello world');
      expect(state.isStreaming).toBe(false);

      destroy();
      aiStore.destroy();
    });
  });

  describe('updates propagate', () => {
    it('zustand subscribe fires on AI state changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore, destroy } = toZustand(aiStore);

      const statuses: string[] = [];
      zStore.subscribe((state) => {
        statuses.push(state.status);
      });

      aiStore.submit({ events: textStream(['hi']) });
      await waitForStream();

      expect(statuses).toContain('streaming');
      expect(statuses).toContain('complete');

      destroy();
      aiStore.destroy();
    });
  });

  describe('selector reads', () => {
    it('getState() returns correct text after streaming', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore, destroy } = toZustand(aiStore);

      aiStore.submit({ events: textStream(['foo', 'bar']) });
      await waitForStream();

      expect(zStore.getState().text).toBe('foobar');
      expect(zStore.getState().status).toBe('complete');

      destroy();
      aiStore.destroy();
    });

    it('getState() returns computed fields', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore, destroy } = toZustand(aiStore);

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();

      expect(zStore.getState().isIdle).toBe(false);
      expect(zStore.getState().isStreaming).toBe(false);
      expect(zStore.getState().hasMessages).toBe(true);

      destroy();
      aiStore.destroy();
    });
  });

  describe('destroy', () => {
    it('destroy() stops syncing from AIStore to zustand', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore, destroy } = toZustand(aiStore);

      destroy();

      aiStore.submit({ events: textStream(['after', ' ', 'destroy']) });
      await waitForStream();

      // Zustand store should still have the initial state since sync was stopped
      expect(zStore.getState().text).toBe('');
      expect(zStore.getState().status).toBe('idle');

      aiStore.destroy();
    });

    it('destroy() does not affect AIStore itself', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { destroy } = toZustand(aiStore);

      destroy();

      aiStore.submit({ events: textStream(['still', ' ', 'works']) });
      await waitForStream();

      // AIStore continues to function
      expect(aiStore.get('text')).toBe('still works');
      expect(aiStore.get('status')).toBe('complete');

      aiStore.destroy();
    });
  });

  describe('multiple adapters', () => {
    it('two zustand stores from same AIStore work independently', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore1, destroy: destroy1 } = toZustand(aiStore);
      const { store: zStore2, destroy: destroy2 } = toZustand(aiStore);

      aiStore.submit({ events: textStream(['shared']) });
      await waitForStream();

      // Both receive the same state
      expect(zStore1.getState().text).toBe('shared');
      expect(zStore2.getState().text).toBe('shared');

      // Destroy one, the other still works
      destroy1();

      aiStore.reset();
      aiStore.submit({ events: textStream(['only-two']) });
      await waitForStream();

      // zStore1 is stale (frozen at last sync before destroy)
      expect(zStore1.getState().text).toBe('shared');
      // zStore2 still receives updates
      expect(zStore2.getState().text).toBe('only-two');

      destroy2();
      aiStore.destroy();
    });

    it('each zustand store has its own subscriber list', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: zStore1, destroy: destroy1 } = toZustand(aiStore);
      const { store: zStore2, destroy: destroy2 } = toZustand(aiStore);

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      zStore1.subscribe(listener1);
      zStore2.subscribe(listener2);

      aiStore.submit({ events: textStream(['test']) });

      // Both listeners called independently
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();

      destroy1();
      destroy2();
      aiStore.destroy();
    });
  });
});
