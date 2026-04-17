import { describe, it, expect } from 'vitest';
import { createRoot } from 'solid-js';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { useAI } from '../src/index.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('useAI', () => {
  describe('initial state', () => {
    it('accessors return correct initial values', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });

      createRoot((dispose) => {
        const ai = useAI(aiStore);

        expect(ai.text()).toBe('');
        expect(ai.status()).toBe('idle');
        expect(ai.messages()).toEqual([]);
        expect(ai.toolCalls()).toEqual([]);
        expect(ai.thinking()).toBe('');
        expect(ai.error()).toBeNull();
        expect(ai.isStreaming()).toBe(false);
        expect(ai.partialObject()).toBeNull();
        expect(ai.object()).toBeNull();

        const state = ai.state();
        expect(state.status).toBe('idle');
        expect(state.isIdle).toBe(true);

        dispose();
      });

      aiStore.destroy();
    });
  });

  describe('state updates', () => {
    it('accessors reflect state changes after streaming', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });

      await createRoot(async (dispose) => {
        const ai = useAI(aiStore);

        aiStore.submit({ events: textStream(['Hello', ' ', 'world']) });
        await waitForStream();

        expect(ai.text()).toBe('Hello world');
        expect(ai.status()).toBe('complete');
        expect(ai.isStreaming()).toBe(false);

        dispose();
      });

      aiStore.destroy();
    });

    it('messages accessor includes submitted user message', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });

      await createRoot(async (dispose) => {
        const ai = useAI(aiStore);

        aiStore.submit({ message: 'hi', events: textStream(['hey']) });
        await waitForStream();

        const msgs = ai.messages();
        expect(msgs.length).toBeGreaterThan(0);
        expect(msgs[0]!.role).toBe('user');

        dispose();
      });

      aiStore.destroy();
    });
  });

  describe('cleanup on scope disposal', () => {
    it('accessors stop updating after dispose', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });

      let textAccessor: () => string;

      const dispose = createRoot((dispose) => {
        const ai = useAI(aiStore);
        textAccessor = ai.text;
        return dispose;
      });

      // Dispose the reactive scope
      dispose();

      // Stream after disposal
      aiStore.submit({ events: textStream(['after', ' dispose']) });
      await waitForStream();

      // The accessor reads from the signal which is no longer updated
      expect(textAccessor!()).toBe('');

      aiStore.destroy();
    });
  });

  describe('all accessor functions', () => {
    it('every accessor is a function', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });

      createRoot((dispose) => {
        const ai = useAI(aiStore);

        const accessors = [
          ai.state,
          ai.text,
          ai.status,
          ai.messages,
          ai.toolCalls,
          ai.thinking,
          ai.error,
          ai.isStreaming,
          ai.partialObject,
          ai.object,
        ];

        for (const accessor of accessors) {
          expect(typeof accessor).toBe('function');
        }

        dispose();
      });

      aiStore.destroy();
    });
  });
});
