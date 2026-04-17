import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { toJotai } from '../src/index.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('toJotai', () => {
  describe('state sync', () => {
    it('jotai store has initial state matching AIStore', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      const state = jotaiStore.get(atoms.state);
      expect(state.status).toBe('idle');
      expect(state.text).toBe('');
      expect(state.messages).toEqual([]);
      expect(state.isIdle).toBe(true);
      expect(state.isStreaming).toBe(false);

      destroy();
      aiStore.destroy();
    });

    it('jotai store reflects state after stream events', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      aiStore.submit({ events: textStream(['Hello', ' ', 'world']) });
      await waitForStream();

      const state = jotaiStore.get(atoms.state);
      expect(state.status).toBe('complete');
      expect(state.text).toBe('Hello world');
      expect(state.isStreaming).toBe(false);

      destroy();
      aiStore.destroy();
    });
  });

  describe('derived atoms', () => {
    it('text atom returns correct text', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      aiStore.submit({ events: textStream(['foo', 'bar']) });
      await waitForStream();

      expect(jotaiStore.get(atoms.text)).toBe('foobar');

      destroy();
      aiStore.destroy();
    });

    it('status atom returns correct status', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.status)).toBe('idle');

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();

      expect(jotaiStore.get(atoms.status)).toBe('complete');

      destroy();
      aiStore.destroy();
    });

    it('isStreaming atom reflects streaming state', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.isStreaming)).toBe(false);

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();

      // After stream complete, isStreaming is false
      expect(jotaiStore.get(atoms.isStreaming)).toBe(false);

      destroy();
      aiStore.destroy();
    });

    it('messages atom returns messages after stream', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      aiStore.submit({ events: textStream(['hello']) });
      await waitForStream();

      const messages = jotaiStore.get(atoms.messages);
      expect(messages.length).toBeGreaterThan(0);
      const assistant = messages.find((m) => m.role === 'assistant');
      expect(assistant).toBeDefined();

      destroy();
      aiStore.destroy();
    });

    it('error atom is null when no error', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.error)).toBeNull();

      destroy();
      aiStore.destroy();
    });

    it('usage atom is null initially', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.usage)).toBeNull();

      destroy();
      aiStore.destroy();
    });

    it('thinking atom returns empty string initially', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.thinking)).toBe('');

      destroy();
      aiStore.destroy();
    });

    it('toolCalls atom returns empty array initially', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.toolCalls)).toEqual([]);

      destroy();
      aiStore.destroy();
    });

    it('partialObject and object atoms are null initially', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      expect(jotaiStore.get(atoms.partialObject)).toBeNull();
      expect(jotaiStore.get(atoms.object)).toBeNull();

      destroy();
      aiStore.destroy();
    });
  });

  describe('updates propagate', () => {
    it('jotai sub fires on state atom changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      const cb = vi.fn();
      jotaiStore.sub(atoms.state, cb);

      aiStore.submit({ events: textStream(['hi']) });
      await waitForStream();

      expect(cb).toHaveBeenCalled();

      destroy();
      aiStore.destroy();
    });

    it('jotai sub on text atom fires when text changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      const cb = vi.fn();
      jotaiStore.sub(atoms.text, cb);

      aiStore.submit({ events: textStream(['hello']) });
      await waitForStream();

      expect(cb).toHaveBeenCalled();
      expect(jotaiStore.get(atoms.text)).toBe('hello');

      destroy();
      aiStore.destroy();
    });

    it('jotai sub on status atom fires on status transitions', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      const cb = vi.fn();
      jotaiStore.sub(atoms.status, cb);

      aiStore.submit({ events: textStream(['x']) });
      await waitForStream();

      expect(cb).toHaveBeenCalled();

      destroy();
      aiStore.destroy();
    });
  });

  describe('destroy', () => {
    it('destroy() stops syncing from AIStore to jotai', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      destroy();

      aiStore.submit({ events: textStream(['after', ' ', 'destroy']) });
      await waitForStream();

      // Jotai store should still have the initial state
      expect(jotaiStore.get(atoms.text)).toBe('');
      expect(jotaiStore.get(atoms.status)).toBe('idle');

      aiStore.destroy();
    });

    it('destroy() does not affect AIStore itself', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { destroy } = toJotai(aiStore);

      destroy();

      aiStore.submit({ events: textStream(['still', ' ', 'works']) });
      await waitForStream();

      expect(aiStore.get('text')).toBe('still works');
      expect(aiStore.get('status')).toBe('complete');

      aiStore.destroy();
    });

    it('destroy() stops sub callbacks from firing', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store: atoms, jotaiStore, destroy } = toJotai(aiStore);

      const cb = vi.fn();
      jotaiStore.sub(atoms.text, cb);

      destroy();
      cb.mockClear();

      aiStore.submit({ events: textStream(['no-fire']) });
      await waitForStream();

      // Callback should not fire since destroy() unsubscribed from AIStore
      expect(cb).not.toHaveBeenCalled();

      aiStore.destroy();
    });
  });
});
