import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { toNanostores } from '../src/index.js';

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

// ── Tests ──

describe('toNanostores', () => {
  describe('state sync', () => {
    it('initial $state matches AIStore state', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      expect(store.$state.get()).toEqual(aiStore.get());

      destroy();
      aiStore.destroy();
    });

    it('syncs state after submitting events', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      // Subscribe to activate computed atoms
      const unsub = store.$state.subscribe(() => {});

      aiStore.submit({ events: textStream(['Hello', ' world']) });
      await waitForStream();

      expect(store.$state.get().text).toBe('Hello world');
      expect(store.$state.get().status).toBe('complete');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('syncs state after tool call events', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$state.subscribe(() => {});

      aiStore.submit({ events: toolStream() });
      await waitForStream();

      expect(store.$state.get().toolCalls).toHaveLength(1);
      expect(store.$state.get().toolCalls[0]!.name).toBe('get_weather');
      expect(store.$state.get().toolCalls[0]!.status).toBe('complete');

      unsub();
      destroy();
      aiStore.destroy();
    });
  });

  describe('derived atoms', () => {
    it('$text returns current text', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$text.subscribe(() => {});

      aiStore.submit({ events: textStream(['Hello']) });
      await waitForStream();

      expect(store.$text.get()).toBe('Hello');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$status reflects current status', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$status.subscribe(() => {});

      expect(store.$status.get()).toBe('idle');

      aiStore.submit({ events: textStream(['hi']) });
      await waitForStream();

      expect(store.$status.get()).toBe('complete');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$isStreaming reflects streaming state', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$isStreaming.subscribe(() => {});

      expect(store.$isStreaming.get()).toBe(false);

      // Use a delayed stream to observe streaming state
      async function* delayedStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'text-delta', text: 'a' };
        await new Promise((r) => setTimeout(r, 30));
        yield { type: 'finish', reason: 'stop' };
      }

      aiStore.submit({ events: delayedStream() });

      // Give the first event time to process
      await new Promise((r) => setTimeout(r, 10));
      expect(store.$isStreaming.get()).toBe(true);

      await waitForStream(60);
      expect(store.$isStreaming.get()).toBe(false);

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$messages returns messages array', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$messages.subscribe(() => {});

      aiStore.submit({ message: 'hi', events: textStream(['reply']) });
      await waitForStream();

      const msgs = store.$messages.get();
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      expect(msgs[0]!.role).toBe('user');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$error returns current error', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$error.subscribe(() => {});

      expect(store.$error.get()).toBeNull();

      async function* errorStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'error', error: new Error('test error') };
      }

      aiStore.submit({ events: errorStream() });
      await waitForStream();

      expect(store.$error.get()).toBeInstanceOf(Error);
      expect(store.$error.get()!.message).toBe('test error');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$thinking returns thinking text', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$thinking.subscribe(() => {});

      async function* thinkingStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'thinking-delta', text: 'Let me think...' };
        yield { type: 'text-delta', text: 'answer' };
        yield { type: 'finish', reason: 'stop' };
      }

      aiStore.submit({ events: thinkingStream() });
      await waitForStream();

      expect(store.$thinking.get()).toBe('Let me think...');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$toolCalls returns tool calls', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$toolCalls.subscribe(() => {});

      aiStore.submit({ events: toolStream() });
      await waitForStream();

      expect(store.$toolCalls.get()).toHaveLength(1);
      expect(store.$toolCalls.get()[0]!.name).toBe('get_weather');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$usage returns token usage', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$usage.subscribe(() => {});

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

      expect(store.$usage.get()).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
      });

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$partialObject and $object start as null', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      expect(store.$partialObject.get()).toBeNull();
      expect(store.$object.get()).toBeNull();

      destroy();
      aiStore.destroy();
    });
  });

  describe('subscribe', () => {
    it('$text.subscribe fires on text changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const values: string[] = [];
      const unsub = store.$text.subscribe((text) => {
        values.push(text);
      });

      aiStore.submit({ events: textStream(['a', 'b', 'c']) });
      await waitForStream();

      // nanostores subscribe fires immediately with the current value, then on changes
      expect(values[0]).toBe(''); // initial value
      expect(values).toContain('a');
      expect(values).toContain('ab');
      expect(values).toContain('abc');

      unsub();
      destroy();
      aiStore.destroy();
    });

    it('$status.subscribe fires on status changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const statuses: string[] = [];
      const unsub = store.$status.subscribe((status) => {
        statuses.push(status);
      });

      aiStore.submit({ events: textStream(['hi']) });
      await waitForStream();

      expect(statuses).toContain('idle');
      expect(statuses).toContain('streaming');
      expect(statuses).toContain('complete');

      unsub();
      destroy();
      aiStore.destroy();
    });
  });

  describe('destroy', () => {
    it('stops syncing after destroy', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const unsub = store.$text.subscribe(() => {});

      aiStore.submit({ events: textStream(['first']) });
      await waitForStream();
      expect(store.$text.get()).toBe('first');

      destroy();

      // Reset and submit new data -- adapter should not sync
      aiStore.reset();
      aiStore.submit({ events: textStream(['second']) });
      await waitForStream();

      // $text should still show old value since adapter was destroyed
      expect(store.$text.get()).toBe('first');

      unsub();
      aiStore.destroy();
    });

    it('does not leak subscriptions after destroy', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const { store, destroy } = toNanostores(aiStore);

      const listener = vi.fn();
      const unsub = store.$state.subscribe(listener);
      listener.mockClear(); // clear the initial call from subscribe

      destroy();

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();

      // No new calls after destroy
      expect(listener).not.toHaveBeenCalled();

      unsub();
      aiStore.destroy();
    });
  });
});
