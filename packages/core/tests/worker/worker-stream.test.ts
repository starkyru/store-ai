import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkerStream } from '../../src/worker/create-worker-stream.js';
import type { StreamEvent } from '../../src/types.js';
import type { WorkerRequest, WorkerResponse } from '../../src/worker/types.js';

// ── Mock Worker ──

type MessageHandler = (e: MessageEvent) => void;

class MockWorker {
  private _listeners: MessageHandler[] = [];
  posted: { data: WorkerRequest; transfer?: Transferable[] }[] = [];

  postMessage(data: WorkerRequest, transfer?: Transferable[]): void {
    this.posted.push({ data, transfer });
  }

  terminate(): void {}

  addEventListener(type: string, fn: MessageHandler): void {
    if (type === 'message') {
      this._listeners.push(fn);
    }
  }

  removeEventListener(type: string, fn: MessageHandler): void {
    if (type === 'message') {
      this._listeners = this._listeners.filter((l) => l !== fn);
    }
  }

  // Test helper: simulate a message from worker back to main thread
  simulateMessage(data: WorkerResponse): void {
    const event = new MessageEvent('message', { data });
    for (const listener of this._listeners) {
      listener(event);
    }
  }

  get listenerCount(): number {
    return this._listeners.length;
  }
}

// ── Helpers ──

function createReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 10));
}

async function collectEvents(
  iterable: AsyncIterable<StreamEvent>,
  max = 50,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
    if (events.length >= max) break;
  }
  return events;
}

// ── Tests ──

describe('createWorkerStream', () => {
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = new MockWorker();
  });

  it('posts start message to worker with correct provider', async () => {
    const stream = createReadableStream([]);

    createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId: 'test-1',
    });

    await flush();

    const startMsg = mockWorker.posted.find((p) => p.data.type === 'start');
    expect(startMsg).toBeDefined();
    expect(startMsg!.data).toEqual(
      expect.objectContaining({
        type: 'start',
        streamId: 'test-1',
        provider: 'anthropic',
      }),
    );
  });

  it('forwards stream chunks to worker', async () => {
    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5, 6]);
    const stream = createReadableStream([chunk1, chunk2]);

    createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'openai',
      streamId: 'test-2',
    });

    await flush();

    const chunkMsgs = mockWorker.posted.filter((p) => p.data.type === 'chunk');
    expect(chunkMsgs).toHaveLength(2);
    expect(chunkMsgs[0]!.data.type).toBe('chunk');
    expect(chunkMsgs[1]!.data.type).toBe('chunk');
  });

  it('posts end message when stream finishes', async () => {
    const stream = createReadableStream([new Uint8Array([1])]);

    createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId: 'test-3',
    });

    await flush();

    const endMsg = mockWorker.posted.find((p) => p.data.type === 'end');
    expect(endMsg).toBeDefined();
    expect(endMsg!.data).toEqual(expect.objectContaining({ type: 'end', streamId: 'test-3' }));
  });

  it('yields events received from worker', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-4';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    await flush();

    // Simulate events from the worker
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'text-delta', text: 'Hello' },
    });
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'text-delta', text: ' world' },
    });
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'finish', reason: 'stop' },
    });
    mockWorker.simulateMessage({ type: 'done', streamId });

    const events = await collectEvents(iterable);

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'Hello' });
    expect(events[1]).toEqual({ type: 'text-delta', text: ' world' });
    expect(events[2]).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('abort signal posts abort message and ends iterable', async () => {
    const controller = new AbortController();
    const stream = createReadableStream([]);
    const streamId = 'test-5';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
      signal: controller.signal,
    });

    await flush();

    // Emit one event, then abort
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'text-delta', text: 'partial' },
    });

    controller.abort();
    await flush();

    const abortMsg = mockWorker.posted.find((p) => p.data.type === 'abort');
    expect(abortMsg).toBeDefined();
    expect(abortMsg!.data).toEqual(expect.objectContaining({ type: 'abort', streamId }));

    const events = await collectEvents(iterable);
    // Should get the event that arrived before abort
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
  });

  it('worker error message yields error event and ends iterable', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-6';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    await flush();

    mockWorker.simulateMessage({
      type: 'error',
      streamId,
      message: 'Parse failure',
    });

    const events = await collectEvents(iterable);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('error');
    if (events[0]!.type === 'error') {
      expect(events[0]!.error.message).toBe('Parse failure');
    }
  });

  it('ignores messages for different streamId', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-7';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    await flush();

    // Message for a different stream
    mockWorker.simulateMessage({
      type: 'event',
      streamId: 'other-stream',
      event: { type: 'text-delta', text: 'wrong stream' },
    });

    // Message for our stream
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'text-delta', text: 'right stream' },
    });
    mockWorker.simulateMessage({ type: 'done', streamId });

    const events = await collectEvents(iterable);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'right stream' });
  });

  it('generates a streamId if not provided', async () => {
    const stream = createReadableStream([]);

    // Mock crypto.randomUUID
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = vi.fn(() => 'generated-uuid');

    try {
      createWorkerStream({
        worker: mockWorker as unknown as Worker,
        stream,
        provider: 'anthropic',
      });

      await flush();

      const startMsg = mockWorker.posted.find((p) => p.data.type === 'start');
      expect(startMsg).toBeDefined();
      expect(startMsg!.data).toEqual(
        expect.objectContaining({
          type: 'start',
          streamId: 'generated-uuid',
        }),
      );
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it('transfers chunk buffers for zero-copy', async () => {
    const chunk = new Uint8Array([10, 20, 30]);
    const stream = createReadableStream([chunk]);

    createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId: 'test-transfer',
    });

    await flush();

    const chunkMsgs = mockWorker.posted.filter((p) => p.data.type === 'chunk');
    expect(chunkMsgs).toHaveLength(1);
    // The transfer array should contain the buffer
    expect(chunkMsgs[0]!.transfer).toBeDefined();
    expect(chunkMsgs[0]!.transfer!.length).toBe(1);
  });

  it('already-aborted signal posts abort immediately', async () => {
    const controller = new AbortController();
    controller.abort();

    const stream = createReadableStream([new Uint8Array([1])]);

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId: 'test-pre-aborted',
      signal: controller.signal,
    });

    await flush();

    const abortMsg = mockWorker.posted.find((p) => p.data.type === 'abort');
    expect(abortMsg).toBeDefined();

    const events = await collectEvents(iterable);
    expect(events).toHaveLength(0);
  });

  it('iterator return() cleans up listener', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-cleanup';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    const initialListenerCount = mockWorker.listenerCount;

    const iterator = iterable[Symbol.asyncIterator]();
    // End the stream so iterator can complete
    mockWorker.simulateMessage({ type: 'done', streamId });
    await flush();

    await iterator.return!();

    expect(mockWorker.listenerCount).toBe(0);
  });

  it('cleans up listener after natural completion', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-natural-cleanup';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    await flush();
    expect(mockWorker.listenerCount).toBeGreaterThan(0);

    mockWorker.simulateMessage({ type: 'done', streamId });
    await collectEvents(iterable);

    expect(mockWorker.listenerCount).toBe(0);
  });

  it('idempotent cleanup on double return', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-double-return';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    mockWorker.simulateMessage({ type: 'done', streamId });
    await flush();

    const iterator = iterable[Symbol.asyncIterator]();
    await iterator.return!();
    // Second return should be a harmless no-op
    await iterator.return!();

    expect(mockWorker.listenerCount).toBe(0);
  });

  it('silently drops worker events with invalid type', async () => {
    const stream = createReadableStream([]);
    const streamId = 'test-invalid-event';

    const iterable = createWorkerStream({
      worker: mockWorker as unknown as Worker,
      stream,
      provider: 'anthropic',
      streamId,
    });

    await flush();

    // Valid event
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'text-delta', text: 'valid' },
    });
    // Invalid event type — should be silently dropped
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'injected-xss-type', payload: '<script>alert(1)</script>' } as any,
    });
    // Another valid event, then done
    mockWorker.simulateMessage({
      type: 'event',
      streamId,
      event: { type: 'finish', reason: 'stop' },
    });
    mockWorker.simulateMessage({ type: 'done', streamId });

    const events = await collectEvents(iterable);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'valid' });
    expect(events[1]).toEqual({ type: 'finish', reason: 'stop' });
  });
});
