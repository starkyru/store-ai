import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSocketTransport, submitViaWebSocket } from '../../src/transports/websocket.js';
import { createAIStore } from '../../src/store.js';
import type { StreamEvent } from '../../src/types.js';

// ── Mock WebSocket ──

type MessageHandler = (e: { data: string }) => void;
type SimpleHandler = () => void;
type ErrorHandler = (e: Event) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  onopen: SimpleHandler | null = null;
  onmessage: MessageHandler | null = null;
  onclose: SimpleHandler | null = null;
  onerror: ErrorHandler | null = null;
  readyState = MockWebSocket.CONNECTING;

  sent: string[] = [];

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    // Schedule open on next microtask so handlers can be attached
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
      }
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    queueMicrotask(() => {
      this.onclose?.();
    });
  }

  // Test helpers

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  simulateError(): void {
    this.onerror?.({} as Event);
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

let lastCreatedWs: MockWebSocket | null = null;

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  lastCreatedWs = null;
  globalThis.WebSocket = class extends MockWebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols);
      lastCreatedWs = this;
    }
  } as unknown as typeof WebSocket;

  // Expose static constants on the mock class assigned to globalThis
  (globalThis.WebSocket as unknown as typeof MockWebSocket).CONNECTING = MockWebSocket.CONNECTING;
  (globalThis.WebSocket as unknown as typeof MockWebSocket).OPEN = MockWebSocket.OPEN;
  (globalThis.WebSocket as unknown as typeof MockWebSocket).CLOSING = MockWebSocket.CLOSING;
  (globalThis.WebSocket as unknown as typeof MockWebSocket).CLOSED = MockWebSocket.CLOSED;
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

function getWs(): MockWebSocket {
  if (!lastCreatedWs) throw new Error('No WebSocket created yet');
  return lastCreatedWs;
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

describe('createWebSocketTransport', () => {
  it('receives text messages as text-delta events (format: text)', async () => {
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'text' });

    await flush();
    const ws = getWs();
    ws.simulateMessage('Hello');
    ws.simulateMessage(' world');
    ws.simulateClose();

    const events = await collectEvents(iter);

    const textDeltas = events.filter((e) => e.type === 'text-delta');
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
    expect(textDeltas[1]).toEqual({ type: 'text-delta', text: ' world' });
  });

  it('receives JSON messages as StreamEvent (format: json)', async () => {
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'json' });

    await flush();
    const ws = getWs();
    ws.simulateMessage(JSON.stringify({ type: 'text-delta', text: 'Hi' }));
    ws.simulateMessage(JSON.stringify({ type: 'finish', reason: 'stop' }));
    ws.simulateClose();

    const events = await collectEvents(iter);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'Hi' });
    expect(events[1]).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('custom transformMessage works', async () => {
    const transformMessage = vi.fn((data: unknown) => {
      const text = String(data);
      return { type: 'text-delta', text: text.toUpperCase() } as StreamEvent;
    });

    const iter = createWebSocketTransport({ url: 'ws://test', transformMessage });

    await flush();
    const ws = getWs();
    ws.simulateMessage('hello');
    ws.simulateClose();

    const events = await collectEvents(iter);

    expect(transformMessage).toHaveBeenCalledWith('hello');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'HELLO' });
  });

  it('transformMessage returning null skips the message', async () => {
    const transformMessage = vi.fn((_data: unknown) => null);

    const iter = createWebSocketTransport({ url: 'ws://test', transformMessage });

    await flush();
    const ws = getWs();
    ws.simulateMessage('skip this');
    ws.simulateMessage('skip that');
    ws.simulateClose();

    const events = await collectEvents(iter);

    expect(transformMessage).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(0);
  });

  it('WebSocket error yields error event', async () => {
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'text' });

    await flush();
    const ws = getWs();
    ws.simulateError();

    const events = await collectEvents(iter);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('error');
    if (events[0]!.type === 'error') {
      expect(events[0]!.error.message).toBe('WebSocket error');
    }
  });

  it('WebSocket close ends the generator', async () => {
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'text' });

    await flush();
    const ws = getWs();
    ws.simulateMessage('before close');
    ws.simulateClose();

    const events = await collectEvents(iter);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'before close' });
  });

  it('AbortSignal closes the WebSocket', async () => {
    const controller = new AbortController();
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'text' }, controller.signal);

    await flush();
    const ws = getWs();
    ws.simulateMessage('data');
    controller.abort();

    const events = await collectEvents(iter);

    const finishEvents = events.filter((e) => e.type === 'finish');
    expect(finishEvents).toHaveLength(1);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('onOpen callback fires with WebSocket instance', async () => {
    const onOpen = vi.fn();
    createWebSocketTransport({ url: 'ws://test', format: 'text', onOpen });

    await flush();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ url: 'ws://test' }));
  });

  it('skips JSON messages without a type field', async () => {
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'json' });

    await flush();
    const ws = getWs();
    ws.simulateMessage(JSON.stringify({ noType: true }));
    ws.simulateMessage(JSON.stringify({ type: 'text-delta', text: 'valid' }));
    ws.simulateClose();

    const events = await collectEvents(iter);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'valid' });
  });

  it('skips malformed JSON messages', async () => {
    const iter = createWebSocketTransport({ url: 'ws://test', format: 'json' });

    await flush();
    const ws = getWs();
    ws.simulateMessage('not valid json{{{');
    ws.simulateMessage(JSON.stringify({ type: 'text-delta', text: 'ok' }));
    ws.simulateClose();

    const events = await collectEvents(iter);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'ok' });
  });
});

describe('submitViaWebSocket', () => {
  it('sends message and streams response through the store', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    submitViaWebSocket(store, {
      url: 'ws://test',
      format: 'text',
      message: 'hello',
    });

    await flush();
    const ws = getWs();

    expect(ws.sent).toContain('hello');

    ws.simulateMessage('response');
    ws.simulateClose();

    await flush();

    expect(store.get('text')).toBe('response');
  });

  it('calls custom onOpen alongside sending message', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });
    const onOpen = vi.fn();

    submitViaWebSocket(store, {
      url: 'ws://test',
      format: 'text',
      message: 'prompt',
      onOpen,
    });

    await flush();
    const ws = getWs();

    expect(ws.sent).toContain('prompt');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('returns a StreamHandle that can abort', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    const handle = submitViaWebSocket(store, {
      url: 'ws://test',
      format: 'text',
    });

    expect(handle).toHaveProperty('abort');
    expect(handle).toHaveProperty('signal');

    await flush();
    handle.abort();
    // Allow time for the abort signal to propagate through the async
    // iterable, the store's consumeStream loop, and the WebSocket close.
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(store.get('status')).toBe('aborted');
  });
});
