import { describe, it, expect } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { createAIReadable } from '../src/index.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

/** Read the current value from a Svelte-compatible store */
function readStore<T>(readable: { subscribe: (fn: (v: T) => void) => () => void }): T {
  let value: T;
  const unsub = readable.subscribe((v) => {
    value = v;
  });
  unsub();
  return value!;
}

// ── Tests ──

describe('createAIReadable', () => {
  describe('Svelte store contract', () => {
    it('subscribe() immediately invokes callback with current value', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      const values: string[] = [];
      const unsub = readable.text.subscribe((v) => {
        values.push(v);
      });

      // First call should be immediate with initial value
      expect(values).toHaveLength(1);
      expect(values[0]).toBe('');

      unsub();
      aiStore.destroy();
    });

    it('subscribe() fires callback on state changes', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      const values: string[] = [];
      const unsub = readable.text.subscribe((v) => {
        values.push(v);
      });

      aiStore.submit({ events: textStream(['Hello', ' world']) });
      await waitForStream();

      expect(values.length).toBeGreaterThan(1);
      expect(values[values.length - 1]).toBe('Hello world');

      unsub();
      aiStore.destroy();
    });

    it('returned unsub function stops updates', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      const values: string[] = [];
      const unsub = readable.text.subscribe((v) => {
        values.push(v);
      });

      // Initial value
      expect(values).toHaveLength(1);

      unsub();

      aiStore.submit({ events: textStream(['after', ' unsub']) });
      await waitForStream();

      // Should still have only the initial value
      expect(values).toHaveLength(1);
      expect(values[0]).toBe('');

      aiStore.destroy();
    });
  });

  describe('selector-based stores', () => {
    it('text store returns correct text after streaming', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      aiStore.submit({ events: textStream(['foo', 'bar']) });
      await waitForStream();

      expect(readStore(readable.text)).toBe('foobar');

      aiStore.destroy();
    });

    it('status store tracks streaming lifecycle', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      const statuses: string[] = [];
      const unsub = readable.status.subscribe((v) => {
        statuses.push(v);
      });

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();

      expect(statuses[0]).toBe('idle');
      expect(statuses).toContain('streaming');
      expect(statuses[statuses.length - 1]).toBe('complete');

      unsub();
      aiStore.destroy();
    });

    it('isStreaming store reflects boolean state', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      expect(readStore(readable.isStreaming)).toBe(false);

      const streamingValues: boolean[] = [];
      const unsub = readable.isStreaming.subscribe((v) => {
        streamingValues.push(v);
      });

      aiStore.submit({ events: textStream(['x']) });
      await waitForStream();

      expect(streamingValues[0]).toBe(false);
      expect(streamingValues).toContain(true);
      expect(streamingValues[streamingValues.length - 1]).toBe(false);

      unsub();
      aiStore.destroy();
    });

    it('error store is null initially and on success', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      expect(readStore(readable.error)).toBeNull();

      aiStore.submit({ events: textStream(['ok']) });
      await waitForStream();

      expect(readStore(readable.error)).toBeNull();

      aiStore.destroy();
    });

    it('messages store reflects sent messages', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      expect(readStore(readable.messages)).toEqual([]);

      aiStore.submit({ message: 'hi', events: textStream(['hey']) });
      await waitForStream();

      const msgs = readStore(readable.messages);
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs[0]!.role).toBe('user');

      aiStore.destroy();
    });
  });

  describe('all stores in createAIReadable', () => {
    it('every returned store has a subscribe method', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      const keys = [
        'state',
        'text',
        'status',
        'messages',
        'toolCalls',
        'thinking',
        'error',
        'isStreaming',
        'partialObject',
        'object',
      ] as const;

      for (const key of keys) {
        expect(typeof readable[key].subscribe).toBe('function');
      }

      aiStore.destroy();
    });

    it('all stores return sensible initial values', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const readable = createAIReadable(aiStore);

      expect(readStore(readable.text)).toBe('');
      expect(readStore(readable.status)).toBe('idle');
      expect(readStore(readable.messages)).toEqual([]);
      expect(readStore(readable.toolCalls)).toEqual([]);
      expect(readStore(readable.thinking)).toBe('');
      expect(readStore(readable.error)).toBeNull();
      expect(readStore(readable.isStreaming)).toBe(false);
      expect(readStore(readable.partialObject)).toBeNull();
      expect(readStore(readable.object)).toBeNull();

      const state = readStore(readable.state);
      expect(state.status).toBe('idle');
      expect(state.isIdle).toBe(true);

      aiStore.destroy();
    });
  });
});
