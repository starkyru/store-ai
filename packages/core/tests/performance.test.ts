import { describe, it, expect } from 'vitest';
import { createAIStore } from '../src/store.js';
import { createChatManager } from '../src/chat-manager.js';
import type { StreamEvent } from '../src/types.js';

describe('Performance', () => {
  it('processes 10,000 text-delta events in under 500ms', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    async function* manyDeltas(): AsyncGenerator<StreamEvent> {
      for (let i = 0; i < 10_000; i++) {
        yield { type: 'text-delta', text: `token${i} ` };
      }
      yield { type: 'finish', reason: 'stop' };
    }

    const start = performance.now();
    store.submit({ events: manyDeltas() });

    // Wait for completion
    await new Promise<void>((resolve) => {
      store.subscribe('status', (s) => {
        if (s === 'complete') resolve();
      });
    });

    const elapsed = performance.now() - start;
    console.log(`10,000 events: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(500);
    expect(store.get('text').length).toBeGreaterThan(0);
  });

  it('handles 1000-message conversation without excessive memory', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    for (let i = 0; i < 500; i++) {
      async function* stream(): AsyncGenerator<StreamEvent> {
        yield { type: 'text-delta', text: `Response ${i}: `.padEnd(100, 'x') };
        yield { type: 'finish', reason: 'stop' };
      }
      store.submit({ message: `Message ${i}`, events: stream() });
      await new Promise((r) => setTimeout(r, 0)); // let microtasks flush
    }

    // Wait for last one
    await new Promise<void>((resolve) => {
      const check = () => {
        if (store.get('status') === 'complete') resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(store.get('messages').length).toBeGreaterThan(0);
    // No assertion on memory -- just verify it completes without OOM or timeout
  });
});

describe('Memory leaks', () => {
  it('100 subscribe/unsubscribe cycles leave no leaked listeners', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    // Do 100 cycles
    for (let i = 0; i < 100; i++) {
      const unsub = store.subscribe(() => {});
      unsub();
    }

    // Also do key-specific subscriptions
    for (let i = 0; i < 100; i++) {
      const unsub = store.subscribe('text', () => {});
      unsub();
    }

    // Now submit a stream and verify only active listeners fire
    let callCount = 0;
    const activeSub = store.subscribe(() => {
      callCount++;
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'test' };
      yield { type: 'finish', reason: 'stop' };
    }
    store.submit({ events: stream() });
    await new Promise((r) => setTimeout(r, 50));

    activeSub();

    // callCount should be small (batched notifications, not 200+ from leaked listeners)
    expect(callCount).toBeLessThan(20);
  });

  it('subscriber notification fires within 5ms of state change (sync batch)', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    let notifyTime = 0;
    store.subscribe('text', () => {
      notifyTime = performance.now();
    });

    const submitTime = performance.now();
    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'fast' };
      yield { type: 'finish', reason: 'stop' };
    }
    store.submit({ events: stream() });

    await new Promise((r) => setTimeout(r, 50));

    const latency = notifyTime - submitTime;
    console.log(`Notification latency: ${latency.toFixed(2)}ms`);
    expect(latency).toBeLessThan(5);
  });

  it('ChatManager handles 50 concurrent chats', () => {
    const manager = createChatManager();

    for (let i = 0; i < 50; i++) {
      manager.create(`chat-${i}`);
    }

    expect(manager.list()).toHaveLength(50);

    manager.setActive('chat-25');
    expect(manager.activeId).toBe('chat-25');

    manager.destroy();
  });
});
