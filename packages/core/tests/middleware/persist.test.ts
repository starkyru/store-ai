import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '../../src/store.js';
import { persist } from '../../src/middleware/persist.js';
import { memoryStorage } from '../../src/storage/memory.js';
import type { StorageAdapter, StreamEvent } from '../../src/types.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('persist middleware', () => {
  it('saves messages on stream complete', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-1')],
    });

    store.submit({ message: 'hello', events: textStream(['world']) });
    await waitForStream();

    const saved = await storage.get('chat-1');
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('chat-1');
    expect(saved!.messages.length).toBeGreaterThanOrEqual(1);
    expect(saved!.createdAt).toBeDefined();
    expect(saved!.updatedAt).toBeDefined();
  });

  it('does NOT save on error', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-err')],
    });

    async function* errorStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('stream failed');
    }

    store.submit({ events: errorStream() });
    await waitForStream();

    const saved = await storage.get('chat-err');
    expect(saved).toBeNull();
  });

  it('does NOT save on abort', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-abort')],
    });

    async function* slowStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'start' };
      await new Promise((r) => setTimeout(r, 200));
      yield { type: 'text-delta', text: 'end' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: slowStream() });
    await new Promise((r) => setTimeout(r, 30));
    store.abort();
    await waitForStream();

    const saved = await storage.get('chat-abort');
    expect(saved).toBeNull();
  });

  it('storage errors do not crash the stream', async () => {
    const failingStorage: StorageAdapter = {
      async get() {
        throw new Error('storage get failed');
      },
      async set() {
        throw new Error('storage set failed');
      },
      async delete() {
        throw new Error('storage delete failed');
      },
      async list() {
        throw new Error('storage list failed');
      },
    };

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(failingStorage, 'chat-fail')],
    });

    // Use a stream without finish so onComplete fires via natural end
    async function* noFinishStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
    }

    store.submit({ events: noFinishStream() });
    await waitForStream();

    // Stream should complete normally despite storage failure
    expect(store.get('status')).toBe('complete');
    expect(store.get('text')).toBe('hello');
  });

  it('uses custom chatId', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'my-custom-id')],
    });

    store.submit({ events: textStream(['test']) });
    await waitForStream();

    const saved = await storage.get('my-custom-id');
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('my-custom-id');
  });

  it('uses generated chatId if none provided', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage)],
    });

    store.submit({ events: textStream(['test']) });
    await waitForStream();

    const keys = await storage.list();
    expect(keys).toHaveLength(1);
    // UUID format check
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('preserves createdAt on subsequent saves', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-multi')],
    });

    store.submit({ events: textStream(['first']) });
    await waitForStream();

    const firstSave = await storage.get('chat-multi');
    const originalCreatedAt = firstSave!.createdAt;

    // Second stream
    store.submit({ events: textStream(['second']) });
    await waitForStream();

    const secondSave = await storage.get('chat-multi');
    expect(secondSave!.createdAt).toBe(originalCreatedAt);
    expect(secondSave!.updatedAt).not.toBe(secondSave!.createdAt);
  });
});
