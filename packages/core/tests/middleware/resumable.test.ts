import { describe, it, expect } from 'vitest';
import { createAIStore } from '../../src/store.js';
import {
  resumable,
  getStreamCheckpoint,
  deleteStreamCheckpoint,
} from '../../src/middleware/resumable.js';
import { memoryStorage } from '../../src/storage/memory.js';
import { localStorageAdapter } from '../../src/storage/local-storage.js';
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

describe('resumable middleware', () => {
  it('saves events to storage periodically', async () => {
    const storage = memoryStorage();
    // 12 events total: 11 text-delta + 1 finish → should flush at event 10
    const chunks = Array.from({ length: 11 }, (_, i) => `chunk-${i}`);

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'periodic-test' })],
    });

    store.submit({ events: textStream(chunks) });
    await waitForStream();

    const checkpoint = await getStreamCheckpoint(storage, 'periodic-test');
    expect(checkpoint).not.toBeNull();
    // 11 text-delta events + 1 finish event = 12 total
    expect(checkpoint!.events).toHaveLength(12);
    expect(checkpoint!.streamId).toBe('periodic-test');
    expect(checkpoint!.lastEventAt).toBeDefined();
  });

  it('marks checkpoint as completed on finish', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'complete-test' })],
    });

    store.submit({ events: textStream(['hello', 'world']) });
    await waitForStream();

    const checkpoint = await getStreamCheckpoint(storage, 'complete-test');
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.completed).toBe(true);
  });

  it('marks checkpoint as not completed on abort', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'abort-test' })],
    });

    async function* slowStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'start' };
      await new Promise((r) => setTimeout(r, 100));
      yield { type: 'text-delta', text: 'end' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: slowStream() });
    await new Promise((r) => setTimeout(r, 20));
    store.abort();
    // Wait long enough for the slow stream's internal delay to resolve
    // so the abort can be detected at the next loop iteration
    await new Promise<void>((r) => setTimeout(r, 200));

    const checkpoint = await getStreamCheckpoint(storage, 'abort-test');
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.completed).toBe(false);
    // Only the first event before abort
    expect(checkpoint!.events.length).toBeGreaterThanOrEqual(1);
  });

  it('getStreamCheckpoint retrieves saved checkpoint', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'retrieve-test' })],
    });

    store.submit({ events: textStream(['data']) });
    await waitForStream();

    const checkpoint = await getStreamCheckpoint(storage, 'retrieve-test');
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.streamId).toBe('retrieve-test');
    expect(checkpoint!.events.length).toBeGreaterThanOrEqual(1);
    expect(checkpoint!.events[0]!.type).toBe('text-delta');
  });

  it('getStreamCheckpoint returns null for missing stream', async () => {
    const storage = memoryStorage();
    const checkpoint = await getStreamCheckpoint(storage, 'nonexistent');
    expect(checkpoint).toBeNull();
  });

  it('deleteStreamCheckpoint removes checkpoint', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'delete-test' })],
    });

    store.submit({ events: textStream(['bye']) });
    await waitForStream();

    expect(await getStreamCheckpoint(storage, 'delete-test')).not.toBeNull();

    await deleteStreamCheckpoint(storage, 'delete-test');
    expect(await getStreamCheckpoint(storage, 'delete-test')).toBeNull();
  });

  it('replaying checkpoint events into new store restores state', async () => {
    const storage = memoryStorage();
    const store1 = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'replay-test' })],
    });

    store1.submit({ message: 'hello', events: textStream(['world', '!']) });
    await waitForStream();

    const checkpoint = await getStreamCheckpoint(storage, 'replay-test');
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.completed).toBe(true);

    // Replay into a new store
    const store2 = createAIStore({ batchStrategy: 'sync' });

    async function* replayEvents(): AsyncGenerator<StreamEvent> {
      for (const event of checkpoint!.events) {
        yield event;
      }
    }

    store2.submit({ events: replayEvents() });
    await waitForStream();

    // The replayed store should have the same text content
    expect(store2.get('text')).toBe('world!');
    expect(store2.get('status')).toBe('complete');
  });

  it('retrieves checkpoints through localStorageAdapter', async () => {
    const originalLocalStorage = globalThis.localStorage;
    const storageMap = new Map<string, string>();
    const mockLocalStorage = {
      getItem(key: string) {
        return storageMap.has(key) ? storageMap.get(key)! : null;
      },
      setItem(key: string, value: string) {
        storageMap.set(key, value);
      },
      removeItem(key: string) {
        storageMap.delete(key);
      },
      key(index: number) {
        return Array.from(storageMap.keys())[index] ?? null;
      },
      get length() {
        return storageMap.size;
      },
    };

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: mockLocalStorage,
    });

    try {
      const storage = localStorageAdapter('resume-test');
      const store = createAIStore({
        batchStrategy: 'sync',
        middleware: [resumable({ storage, streamId: 'local-storage-test' })],
      });

      store.submit({ events: textStream(['saved']) });
      await waitForStream();

      const checkpoint = await getStreamCheckpoint(storage, 'local-storage-test');
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.completed).toBe(true);
      expect(checkpoint!.events).toHaveLength(2);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });

  it('getStreamCheckpoint returns null for corrupted checkpoint data', async () => {
    const storage = memoryStorage();

    // Completely wrong shape
    await storage.set('stream:corrupt-1', { foo: 'bar' });
    expect(await getStreamCheckpoint(storage, 'corrupt-1')).toBeNull();

    // Missing required fields
    await storage.set('stream:corrupt-2', { streamId: 'corrupt-2', events: [] });
    expect(await getStreamCheckpoint(storage, 'corrupt-2')).toBeNull();

    // events contains invalid items
    await storage.set('stream:corrupt-3', {
      streamId: 'corrupt-3',
      events: [42, 'not-an-event', null],
      completed: true,
      lastEventAt: new Date().toISOString(),
    });
    expect(await getStreamCheckpoint(storage, 'corrupt-3')).toBeNull();

    // events contain objects with unknown type
    await storage.set('stream:corrupt-4', {
      streamId: 'corrupt-4',
      events: [{ type: 'totally-fake-type', data: 'bad' }],
      completed: true,
      lastEventAt: new Date().toISOString(),
    });
    expect(await getStreamCheckpoint(storage, 'corrupt-4')).toBeNull();
  });

  it('rejects invalid streamId format', () => {
    const storage = memoryStorage();

    expect(() => resumable({ storage, streamId: '../traversal' })).toThrow('Invalid streamId');
    expect(() => resumable({ storage, streamId: 'has spaces' })).toThrow('Invalid streamId');
    expect(() => resumable({ storage, streamId: 'ok-id:req-1' })).not.toThrow();
    expect(() => resumable({ storage, streamId: 'simple_id.v2' })).not.toThrow();
  });

  it('storage failures do not crash the stream', async () => {
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
      middleware: [resumable({ storage: failingStorage, streamId: 'fail-test' })],
    });

    store.submit({ events: textStream(['hello']) });
    await waitForStream();

    // Stream should complete normally despite storage failure
    expect(store.get('status')).toBe('complete');
    expect(store.get('text')).toBe('hello');
  });

  it('marks checkpoint as not completed on error', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [resumable({ storage, streamId: 'error-test' })],
    });

    async function* errorStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('stream failed');
    }

    store.submit({ events: errorStream() });
    await waitForStream();

    const checkpoint = await getStreamCheckpoint(storage, 'error-test');
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.completed).toBe(false);
    expect(checkpoint!.events.length).toBeGreaterThanOrEqual(1);
  });

  it('resets event buffer on new stream start', async () => {
    const storage = memoryStorage();
    const mw = resumable({ storage, streamId: 'reset-test' });
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [mw],
    });

    store.submit({ events: textStream(['first']) });
    await waitForStream();

    const cp1 = await getStreamCheckpoint(storage, 'reset-test');
    expect(cp1!.events).toHaveLength(2); // text-delta + finish

    // Second stream should start fresh
    store.submit({ events: textStream(['second', 'stream']) });
    await waitForStream();

    const cp2 = await getStreamCheckpoint(storage, 'reset-test');
    expect(cp2!.events).toHaveLength(3); // 2 text-delta + finish
    expect((cp2!.events[0] as any).text).toBe('second');
  });
});
