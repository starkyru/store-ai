import { describe, it, expect } from 'vitest';
import { createAIStore } from '@store-ai/core';
import type { StreamEvent } from '@store-ai/core';
import { AIController } from '../src/index.js';

// ── Mock ReactiveControllerHost ──

class MockHost {
  controllers: any[] = [];
  updateCount = 0;

  addController(c: any) {
    this.controllers.push(c);
  }

  removeController() {}

  requestUpdate() {
    this.updateCount++;
  }

  get updateComplete() {
    return Promise.resolve(true);
  }
}

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('AIController', () => {
  describe('constructor', () => {
    it('registers controller with host', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();

      const controller = new AIController(host as any, aiStore);

      expect(host.controllers).toContain(controller);

      aiStore.destroy();
    });

    it('captures initial state from store', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();

      const controller = new AIController(host as any, aiStore);

      expect(controller.text).toBe('');
      expect(controller.status).toBe('idle');
      expect(controller.messages).toEqual([]);
      expect(controller.isStreaming).toBe(false);

      aiStore.destroy();
    });
  });

  describe('hostConnected', () => {
    it('subscribes to store and has correct initial state', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();

      expect(controller.status).toBe('idle');
      expect(controller.text).toBe('');

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('state updates trigger requestUpdate on host', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      const beforeCount = host.updateCount;

      aiStore.submit({ events: textStream(['Hello', ' world']) });
      await waitForStream();

      expect(host.updateCount).toBeGreaterThan(beforeCount);
      expect(controller.text).toBe('Hello world');

      controller.hostDisconnected();
      aiStore.destroy();
    });
  });

  describe('getters', () => {
    it('text returns correct value after streaming', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();

      aiStore.submit({ events: textStream(['foo', 'bar']) });
      await waitForStream();

      expect(controller.text).toBe('foobar');

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('status tracks streaming lifecycle', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.status).toBe('idle');

      aiStore.submit({ events: textStream(['data']) });
      await waitForStream();

      expect(controller.status).toBe('complete');

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('messages reflects sent messages', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.messages).toEqual([]);

      aiStore.submit({ message: 'hi', events: textStream(['hey']) });
      await waitForStream();

      expect(controller.messages.length).toBeGreaterThan(0);
      expect(controller.messages[0]!.role).toBe('user');

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('toolCalls returns current tool calls', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.toolCalls).toEqual([]);

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('thinking returns thinking text', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.thinking).toBe('');

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('error returns null initially and on success', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.error).toBeNull();

      aiStore.submit({ events: textStream(['ok']) });
      await waitForStream();

      expect(controller.error).toBeNull();

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('isStreaming reflects boolean state', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.isStreaming).toBe(false);

      aiStore.submit({ events: textStream(['x']) });
      await waitForStream();

      expect(controller.isStreaming).toBe(false);

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('partialObject returns null initially', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.partialObject).toBeNull();

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('object returns null initially', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      expect(controller.object).toBeNull();

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('state returns the full state object', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();

      const state = controller.state;
      expect(state.status).toBe('idle');
      expect(state.isIdle).toBe(true);
      expect(state.text).toBe('');

      controller.hostDisconnected();
      aiStore.destroy();
    });
  });

  describe('hostDisconnected', () => {
    it('unsubscribes from store (no more requestUpdate calls)', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      controller.hostConnected();
      controller.hostDisconnected();

      const countAfterDisconnect = host.updateCount;

      aiStore.submit({ events: textStream(['after', ' disconnect']) });
      await waitForStream();

      expect(host.updateCount).toBe(countAfterDisconnect);

      aiStore.destroy();
    });

    it('can be called safely when not connected', () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      // Should not throw
      controller.hostDisconnected();

      aiStore.destroy();
    });
  });

  describe('multiple connect/disconnect cycles', () => {
    it('works correctly across multiple lifecycle cycles', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      // First cycle
      controller.hostConnected();
      aiStore.submit({ events: textStream(['first']) });
      await waitForStream();
      expect(controller.text).toBe('first');
      controller.hostDisconnected();

      const countAfterFirst = host.updateCount;

      // Verify no updates after disconnect
      aiStore.submit({ events: textStream(['ignored']) });
      await waitForStream();
      expect(host.updateCount).toBe(countAfterFirst);

      // Second cycle - re-read current state
      controller.hostConnected();
      const updateCountBeforeSecond = host.updateCount;

      aiStore.submit({ events: textStream(['second']) });
      await waitForStream();

      expect(host.updateCount).toBeGreaterThan(updateCountBeforeSecond);

      controller.hostDisconnected();
      aiStore.destroy();
    });

    it('third cycle still works', async () => {
      const aiStore = createAIStore({ batchStrategy: 'sync' });
      const host = new MockHost();
      const controller = new AIController(host as any, aiStore);

      // Cycle 1
      controller.hostConnected();
      controller.hostDisconnected();

      // Cycle 2
      controller.hostConnected();
      controller.hostDisconnected();

      // Cycle 3
      controller.hostConnected();
      aiStore.submit({ events: textStream(['cycle3']) });
      await waitForStream();
      expect(controller.text).toContain('cycle3');

      controller.hostDisconnected();
      aiStore.destroy();
    });
  });
});
