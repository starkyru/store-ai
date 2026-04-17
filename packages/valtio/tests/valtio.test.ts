import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { snapshot, subscribe } from 'valtio/vanilla';
import { toValtio } from '../src/index.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

async function* toolStream(): AsyncGenerator<StreamEvent> {
  yield { type: 'tool-call-start', id: 'tc-1', name: 'get_weather' };
  yield { type: 'tool-call-delta', id: 'tc-1', inputDelta: '{"city":"SF"}' };
  yield { type: 'tool-call-end', id: 'tc-1', input: { city: 'SF' } };
  yield { type: 'finish', reason: 'tool-calls' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// Valtio subscribe is async (batched via microtask), so we need to flush
async function flushValtioUpdates(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 10));
}

// ── Tests ──

describe('toValtio', () => {
  describe('state sync', () => {
    it('initial state matches AIStore state', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      const snap = snapshot(store);
      expect(snap.status).toBe('idle');
      expect(snap.text).toBe('');
      expect(snap.messages).toEqual([]);
      expect(snap.isStreaming).toBe(false);
      expect(snap.isIdle).toBe(true);

      destroy();
      aiStore.destroy();
    });

    it('syncs state after submitting text events', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      aiStore.submit({ events: textStream(['Hello', ' world']) });
      await waitForStream();

      const snap = snapshot(store);
      expect(snap.text).toBe('Hello world');
      expect(snap.status).toBe('complete');

      destroy();
      aiStore.destroy();
    });

    it('syncs state after tool call events', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      aiStore.submit({ events: toolStream() });
      await waitForStream();

      const snap = snapshot(store);
      expect(snap.toolCalls).toHaveLength(1);
      expect(snap.toolCalls[0]!.name).toBe('get_weather');
      expect(snap.toolCalls[0]!.status).toBe('complete');

      destroy();
      aiStore.destroy();
    });

    it('syncs error state', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      async function* errorStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'error', error: new Error('test error') };
      }

      aiStore.submit({ events: errorStream() });
      await waitForStream();

      const snap = snapshot(store);
      expect(snap.error).toBeInstanceOf(Error);
      expect(snap.error!.message).toBe('test error');
      expect(snap.status).toBe('error');

      destroy();
      aiStore.destroy();
    });
  });

  describe('property access', () => {
    it('text property is reactive', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      expect(store.text).toBe('');

      aiStore.submit({ events: textStream(['Hello']) });
      await waitForStream();

      expect(store.text).toBe('Hello');

      destroy();
      aiStore.destroy();
    });

    it('status property is reactive', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      expect(store.status).toBe('idle');

      aiStore.submit({ events: textStream(['hi']) });
      await waitForStream();

      expect(store.status).toBe('complete');

      destroy();
      aiStore.destroy();
    });

    it('isStreaming property reflects streaming state', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      expect(store.isStreaming).toBe(false);

      async function* delayedStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'text-delta', text: 'a' };
        await new Promise((r) => setTimeout(r, 30));
        yield { type: 'finish', reason: 'stop' };
      }

      aiStore.submit({ events: delayedStream() });
      await new Promise((r) => setTimeout(r, 10));

      expect(store.isStreaming).toBe(true);

      await waitForStream(60);
      expect(store.isStreaming).toBe(false);

      destroy();
      aiStore.destroy();
    });

    it('messages property contains submitted messages', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      aiStore.submit({ message: 'hi', events: textStream(['reply']) });
      await waitForStream();

      expect(store.messages.length).toBeGreaterThanOrEqual(1);
      expect(store.messages[0]!.role).toBe('user');

      destroy();
      aiStore.destroy();
    });

    it('thinking property reflects thinking deltas', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      async function* thinkingStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'thinking-delta', text: 'Let me think...' };
        yield { type: 'text-delta', text: 'answer' };
        yield { type: 'finish', reason: 'stop' };
      }

      aiStore.submit({ events: thinkingStream() });
      await waitForStream();

      expect(store.thinking).toBe('Let me think...');

      destroy();
      aiStore.destroy();
    });

    it('usage property reflects token usage', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      async function* usageStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'text-delta', text: 'hi' };
        yield {
          type: 'usage',
          usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, totalTokens: 15 },
        };
        yield { type: 'finish', reason: 'stop' };
      }

      aiStore.submit({ events: usageStream() });
      await waitForStream();

      const snap = snapshot(store);
      expect(snap.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
      });

      destroy();
      aiStore.destroy();
    });
  });

  describe('subscribe', () => {
    it('subscribe fires on state changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      const listener = vi.fn();
      const unsub = subscribe(store, listener);

      aiStore.submit({ events: textStream(['hello']) });
      await waitForStream();
      await flushValtioUpdates();

      expect(listener).toHaveBeenCalled();

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('subscribe receives updated snapshots', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      const snapshots: string[] = [];
      const unsub = subscribe(store, () => {
        snapshots.push(snapshot(store).text);
      });

      aiStore.submit({ events: textStream(['a', 'b', 'c']) });
      await waitForStream();
      await flushValtioUpdates();

      // Should have received at least one notification with final text
      expect(snapshots.some((s) => s === 'abc')).toBe(true);

      unsub();
      destroy();
      aiStore.destroy();
    });
  });

  describe('destroy', () => {
    it('stops syncing after destroy', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      aiStore.submit({ events: textStream(['first']) });
      await waitForStream();
      expect(store.text).toBe('first');

      destroy();

      aiStore.reset();
      aiStore.submit({ events: textStream(['second']) });
      await waitForStream();

      // text should still be 'first' since adapter was destroyed
      expect(store.text).toBe('first');

      aiStore.destroy();
    });

    it('does not leak subscriptions after destroy', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toValtio(aiStore);

      const listener = vi.fn();
      const unsub = subscribe(store, listener);

      destroy();
      listener.mockClear();

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();
      await flushValtioUpdates();

      // No new calls after adapter destroy (the valtio proxy isn't being updated)
      expect(listener).not.toHaveBeenCalled();

      unsub();
      aiStore.destroy();
    });
  });
});
