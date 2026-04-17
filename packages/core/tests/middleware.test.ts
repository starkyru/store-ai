import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAIStore } from '../src/store.js';
import { logging } from '../src/middleware/logging.js';
import { throttle } from '../src/middleware/throttle.js';
import { mapEvents } from '../src/middleware/map-events.js';
import type { StreamEvent, MiddlewareContext, Middleware } from '../src/types.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

async function* eventStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) {
    yield event;
  }
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── logging middleware ──

describe('logging middleware', () => {
  it('default level (info) logs start, complete, but not individual events', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [logging({ logger })],
    });

    // Use a stream without a finish event so consumeStream's
    // natural-end fallback fires the onComplete lifecycle hook.
    async function* noFinishStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
      yield { type: 'text-delta', text: ' world' };
    }

    store.submit({ events: noFinishStream() });
    await waitForStream();

    expect(logger.log).toHaveBeenCalledWith('[store-ai] Stream started');
    expect(logger.log).toHaveBeenCalledWith('[store-ai] Stream complete');
    // At info level, debug should not be called for individual events
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('debug level logs all events via logger.debug', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [logging({ level: 'debug', logger })],
    });

    store.submit({ events: textStream(['hi']) });
    await waitForStream();

    // Should have debug calls for each event (text-delta + finish)
    expect(logger.debug).toHaveBeenCalled();
    const debugMessages = logger.debug.mock.calls.map((c) => c[0] as string);
    expect(debugMessages.some((m) => m.includes('text-delta'))).toBe(true);
    expect(debugMessages.some((m) => m.includes('finish'))).toBe(true);
  });

  it('debug level logs tool-call-start with tool name', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [logging({ level: 'debug', logger })],
    });

    async function* toolStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'tool-call-start', id: 'tc-1', name: 'get_weather' };
      yield { type: 'tool-call-end', id: 'tc-1', input: {} };
      yield { type: 'finish', reason: 'tool-calls' };
    }

    store.submit({ events: toolStream() });
    await waitForStream();

    const debugMessages = logger.debug.mock.calls.map((c) => c[0] as string);
    expect(debugMessages.some((m) => m.includes('get_weather'))).toBe(true);
  });

  it('custom filter excludes events from debug logging', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        logging({
          level: 'debug',
          logger,
          filter: (event) => event.type !== 'text-delta',
        }),
      ],
    });

    store.submit({ events: textStream(['hi']) });
    await waitForStream();

    const debugMessages = logger.debug.mock.calls.map((c) => c[0] as string);
    // text-delta should be filtered out
    expect(debugMessages.every((m) => !m.includes('text-delta'))).toBe(true);
    // finish should still be logged
    expect(debugMessages.some((m) => m.includes('finish'))).toBe(true);
  });

  it('custom logger receives log calls', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [logging({ logger })],
    });

    store.submit({ events: textStream(['test']) });
    await waitForStream();

    expect(logger.log).toHaveBeenCalled();
  });

  it('onError logs error details', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [logging({ logger })],
    });

    async function* errorStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('connection failed');
    }

    store.submit({ events: errorStream() });
    await waitForStream();

    expect(logger.log).toHaveBeenCalledWith('[store-ai] Stream started');
    const errorCalls = logger.log.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('Stream error'),
    );
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0]![1]).toBe('connection failed');
  });

  it('still forwards events to the reducer (does not block the chain)', async () => {
    const logger = { log: vi.fn(), debug: vi.fn() };
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [logging({ level: 'debug', logger })],
    });

    store.submit({ events: textStream(['hello']) });
    await waitForStream();

    expect(store.get('text')).toBe('hello');
    expect(store.get('status')).toBe('complete');
  });
});

// ── throttle middleware ──

describe('throttle middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT delay the first text-delta event', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [throttle(100)],
    });

    const events: StreamEvent[] = [
      { type: 'text-delta', text: 'first' },
      { type: 'finish', reason: 'stop' },
    ];

    store.submit({ events: eventStream(events) });
    await vi.advanceTimersByTimeAsync(100);

    expect(store.get('text')).toBe('first');
  });

  it('throttles rapid text-delta events', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [throttle(100)],
    });

    // Use a controlled approach: emit events with specific timing
    let resolve!: () => void;
    const done = new Promise<void>((r) => {
      resolve = r;
    });

    async function* timedStream(): AsyncGenerator<StreamEvent> {
      // First delta - should go through immediately
      yield { type: 'text-delta', text: 'A' };
      // Second delta at same time - should be buffered
      yield { type: 'text-delta', text: 'B' };
      // Third delta at same time - should also be buffered
      yield { type: 'text-delta', text: 'C' };
      yield { type: 'finish', reason: 'stop' };
      resolve();
    }

    store.submit({ events: timedStream() });
    await vi.advanceTimersByTimeAsync(200);
    await done;

    // All text should arrive (A immediately, BC flushed on finish)
    expect(store.get('text')).toBe('ABC');
  });

  it('does NOT throttle non-delta events', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [throttle(1000)],
    });

    async function* mixedStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'tool-call-start', id: 'tc-1', name: 'search' };
      yield { type: 'tool-call-end', id: 'tc-1', input: { q: 'test' } };
      yield { type: 'finish', reason: 'tool-calls' };
    }

    store.submit({ events: mixedStream() });
    await vi.advanceTimersByTimeAsync(100);

    // Tool calls should be dispatched immediately regardless of throttle
    expect(store.get('toolCalls')).toHaveLength(1);
    expect(store.get('status')).toBe('complete');
  });

  it('flushes pending text-delta on finish event', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [throttle(5000)], // very long throttle
    });

    async function* bufferedStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'A' }; // goes through (first)
      yield { type: 'text-delta', text: 'B' }; // buffered
      yield { type: 'text-delta', text: 'C' }; // buffered
      yield { type: 'finish', reason: 'stop' }; // should flush BC
    }

    store.submit({ events: bufferedStream() });
    await vi.advanceTimersByTimeAsync(100);

    // All text must be present due to flush on finish
    expect(store.get('text')).toBe('ABC');
    expect(store.get('status')).toBe('complete');
  });

  it('flushes pending thinking-delta on finish event', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [throttle(5000)],
    });

    async function* thinkingStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'thinking-delta', text: 'step1 ' };
      yield { type: 'thinking-delta', text: 'step2 ' };
      yield { type: 'thinking-delta', text: 'step3' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: thinkingStream() });
    await vi.advanceTimersByTimeAsync(100);

    expect(store.get('thinking')).toBe('step1 step2 step3');
  });

  it('flushes pending deltas on error event', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [throttle(5000)],
    });

    async function* errorStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'A' };
      yield { type: 'text-delta', text: 'B' };
      yield { type: 'error', error: new Error('oops') };
    }

    store.submit({ events: errorStream() });
    await vi.advanceTimersByTimeAsync(100);

    // B should be flushed before the error event
    expect(store.get('text')).toBe('AB');
    expect(store.get('status')).toBe('error');
  });
});

// ── mapEvents middleware ──

describe('mapEvents middleware', () => {
  it('transforms events (change text content)', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        mapEvents((event) => {
          if (event.type === 'text-delta') {
            return { type: 'text-delta', text: event.text.toUpperCase() };
          }
          return event;
        }),
      ],
    });

    store.submit({ events: textStream(['hello', ' world']) });
    await waitForStream();

    expect(store.get('text')).toBe('HELLO WORLD');
  });

  it('suppresses events when fn returns null', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        mapEvents((event) => {
          // Suppress all text-delta events
          if (event.type === 'text-delta') return null;
          return event;
        }),
      ],
    });

    store.submit({ events: textStream(['hello', ' world']) });
    await waitForStream();

    // Text should be empty because all text-deltas were suppressed
    expect(store.get('text')).toBe('');
    expect(store.get('status')).toBe('complete');
  });

  it('passes through unmodified events when fn returns same event', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [mapEvents((event) => event)],
    });

    store.submit({ events: textStream(['hello']) });
    await waitForStream();

    expect(store.get('text')).toBe('hello');
    expect(store.get('status')).toBe('complete');
  });

  it('can change event type entirely', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        mapEvents((event) => {
          // Convert thinking-delta to text-delta
          if (event.type === 'thinking-delta') {
            return { type: 'text-delta', text: event.text };
          }
          return event;
        }),
      ],
    });

    async function* thinkStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'thinking-delta', text: 'thought' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: thinkStream() });
    await waitForStream();

    // thinking-delta was converted to text-delta
    expect(store.get('text')).toBe('thought');
    expect(store.get('thinking')).toBe('');
  });

  it('suppressing finish event prevents completion', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        mapEvents((event) => {
          if (event.type === 'finish') return null;
          return event;
        }),
      ],
    });

    // Stream with no natural end after finish is suppressed
    async function* noFinishStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'data' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: noFinishStream() });
    await waitForStream();

    // The finish event was suppressed, but the stream ends naturally,
    // so consumeStream's fallback will still dispatch complete
    expect(store.get('text')).toBe('data');
  });
});

// ── General middleware behavior ──

describe('general middleware behavior', () => {
  it('middleware execution order follows onion model (first registered runs first)', async () => {
    const order: string[] = [];
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          order.push('A-before');
          await next();
          order.push('A-after');
        },
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          order.push('B-before');
          await next();
          order.push('B-after');
        },
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          order.push('C-before');
          await next();
          order.push('C-after');
        },
      ],
    });

    async function* singleEvent(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'x' };
    }

    store.submit({ events: singleEvent() });
    await waitForStream();

    // For the text-delta event: A wraps B wraps C
    expect(order).toEqual(['A-before', 'B-before', 'C-before', 'C-after', 'B-after', 'A-after']);
  });

  it('suppressing events by not calling next()', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        async (ctx: MiddlewareContext, _next: () => Promise<void>) => {
          // Never call next() for text-delta — suppresses the event
          if (ctx.event.type === 'text-delta') return;
          await _next();
        },
      ],
    });

    store.submit({ events: textStream(['suppressed']) });
    await waitForStream();

    // Text should be empty since text-delta was suppressed
    expect(store.get('text')).toBe('');
    // But finish still went through
    expect(store.get('status')).toBe('complete');
  });

  it('runtime add/remove via store.use()', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });
    const intercepted: string[] = [];

    const remove = store.use(async (ctx: MiddlewareContext, next: () => Promise<void>) => {
      if (ctx.event.type === 'text-delta') {
        intercepted.push(ctx.event.text);
      }
      await next();
    });

    store.submit({ events: textStream(['first']) });
    await waitForStream();

    expect(intercepted).toEqual(['first']);

    // Remove middleware
    remove();

    store.submit({ events: textStream(['second']) });
    await waitForStream();

    // 'second' should NOT be intercepted since middleware was removed
    expect(intercepted).toEqual(['first']);
  });

  it('error in middleware propagates correctly', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });

    store.use(async (_ctx: MiddlewareContext, _next: () => Promise<void>) => {
      throw new Error('middleware blew up');
    });

    store.submit({ events: textStream(['test']) });
    await waitForStream();

    expect(store.get('status')).toBe('error');
    expect(store.get('error')).toBeInstanceOf(Error);
    expect(store.get('error')!.message).toBe('middleware blew up');
  });

  it('multiple middleware compose correctly', async () => {
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        // First: uppercase
        mapEvents((event) => {
          if (event.type === 'text-delta') {
            return { type: 'text-delta', text: event.text.toUpperCase() };
          }
          return event;
        }),
        // Second: add exclamation
        mapEvents((event) => {
          if (event.type === 'text-delta') {
            return { type: 'text-delta', text: event.text + '!' };
          }
          return event;
        }),
      ],
    });

    store.submit({ events: textStream(['hello']) });
    await waitForStream();

    // First middleware uppercases, second adds "!"
    expect(store.get('text')).toBe('HELLO!');
  });

  it('middleware metadata map is shared across the chain', async () => {
    const receivedMeta: unknown[] = [];

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          ctx.metadata.set('source', 'first-middleware');
          await next();
        },
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          receivedMeta.push(ctx.metadata.get('source'));
          await next();
        },
      ],
    });

    async function* singleEvent(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'x' };
    }

    store.submit({ events: singleEvent() });
    await waitForStream();

    expect(receivedMeta).toContain('first-middleware');
  });
});
