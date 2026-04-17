import { describe, it, expect } from 'vitest';
import { createAIStore } from '../../src/store.js';
import {
  resumable,
  getStreamCheckpoint,
  deleteStreamCheckpoint,
} from '../../src/middleware/resumable.js';
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
