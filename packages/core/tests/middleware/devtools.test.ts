import { describe, it, expect, beforeEach } from 'vitest';
import { createAIStore } from '../../src/store.js';
import { devtools } from '../../src/middleware/devtools.js';
import type { StreamEvent } from '../../src/types.js';
import type { DevToolsInspector } from '../../src/middleware/devtools.js';

// ── Helpers ──

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('devtools middleware', () => {
  beforeEach(() => {
    // Clean up global between tests
    delete (globalThis as Record<string, unknown>).__STORE_AI_DEVTOOLS__;
  });

  it('records events during streaming', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
      yield { type: 'text-delta', text: ' world' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    expect(inspector.getEventCount()).toBe(3);
  });

  it('events have correct index, timestamp, and elapsed', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const events = inspector.getEvents();
    expect(events[0]!.index).toBe(0);
    expect(events[1]!.index).toBe(1);

    // Timestamps are valid ISO strings
    expect(() => new Date(events[0]!.timestamp)).not.toThrow();
    expect(new Date(events[0]!.timestamp).toISOString()).toBe(events[0]!.timestamp);

    // Elapsed is non-negative
    expect(events[0]!.elapsed).toBeGreaterThanOrEqual(0);
    expect(events[1]!.elapsed).toBeGreaterThanOrEqual(events[0]!.elapsed);
  });

  it('getEvents() returns all events', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'text-delta', text: 'b' };
      yield { type: 'text-delta', text: 'c' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const events = inspector.getEvents();
    expect(events).toHaveLength(4);
    expect(events[0]!.event).toEqual({ type: 'text-delta', text: 'a' });
    expect(events[3]!.event).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('getEvent(index) returns specific event', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const event0 = inspector.getEvent(0);
    expect(event0).toBeDefined();
    expect(event0!.event.type).toBe('text-delta');

    const event1 = inspector.getEvent(1);
    expect(event1).toBeDefined();
    expect(event1!.event.type).toBe('finish');

    const missing = inspector.getEvent(99);
    expect(missing).toBeUndefined();
  });

  it('getEventsByType filters correctly', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'thinking-delta', text: 'hmm' };
      yield { type: 'text-delta', text: 'b' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const textDeltas = inspector.getEventsByType('text-delta');
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas.every((e) => e.event.type === 'text-delta')).toBe(true);

    const finishEvents = inspector.getEventsByType('finish');
    expect(finishEvents).toHaveLength(1);

    const errorEvents = inspector.getEventsByType('error');
    expect(errorEvents).toHaveLength(0);
  });

  it('getEventCount returns correct count', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    expect(inspector.getEventCount()).toBe(0);

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'text-delta', text: 'b' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    expect(inspector.getEventCount()).toBe(3);
  });

  it('getDuration returns elapsed time after completion', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    // Before any stream, duration is null
    expect(inspector.getDuration()).toBeNull();

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const duration = inspector.getDuration();
    expect(duration).not.toBeNull();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('getEventsPerSecond calculation', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    // Before any stream
    expect(inspector.getEventsPerSecond()).toBeNull();

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      // Introduce a small delay so duration is > 0
      await new Promise<void>((r) => setTimeout(r, 10));
      yield { type: 'text-delta', text: 'b' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream(100);

    const eps = inspector.getEventsPerSecond();
    expect(eps).not.toBeNull();
    expect(eps!).toBeGreaterThan(0);
  });

  it('maxEvents limit enforced (oldest dropped)', async () => {
    const { middleware, inspector } = devtools({ maxEvents: 3 });
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'text-delta', text: 'b' };
      yield { type: 'text-delta', text: 'c' };
      yield { type: 'text-delta', text: 'd' };
      yield { type: 'text-delta', text: 'e' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    // 6 events total, but only 3 kept
    expect(inspector.getEventCount()).toBe(3);

    // The oldest events (a, b, c) should be dropped
    const events = inspector.getEvents();
    expect(events[0]!.event).toEqual({ type: 'text-delta', text: 'd' });
    expect(events[1]!.event).toEqual({ type: 'text-delta', text: 'e' });
    expect(events[2]!.event).toEqual({ type: 'finish', reason: 'stop' });
  });

  it('clear() empties the log', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'a' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    expect(inspector.getEventCount()).toBeGreaterThan(0);

    inspector.clear();

    expect(inspector.getEventCount()).toBe(0);
    expect(inspector.getEvents()).toEqual([]);
    expect(inspector.getDuration()).toBeNull();
  });

  it('export() produces valid JSON', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const exported = inspector.export();
    expect(() => JSON.parse(exported)).not.toThrow();

    const parsed = JSON.parse(exported) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('export() serializes errors correctly', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'error', error: new Error('something went wrong') };
      yield { type: 'finish', reason: 'error' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const exported = inspector.export();
    const parsed = JSON.parse(exported) as Array<{
      event: { type: string; error?: { name: string; message: string; stack: string } };
    }>;

    const errorEvent = parsed.find((e) => e.event.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.event.error).toEqual(
      expect.objectContaining({
        name: 'Error',
        message: 'something went wrong',
      }),
    );
    expect(errorEvent!.event.error!.stack).toBeDefined();
  });

  it('multiple streams: onStart resets the log', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    // First stream
    async function* stream1(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'first' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream1() });
    await waitForStream();

    expect(inspector.getEventCount()).toBe(2);

    // Second stream — should reset
    async function* stream2(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'second' };
      yield { type: 'text-delta', text: 'stream' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream2() });
    await waitForStream();

    expect(inspector.getEventCount()).toBe(3);

    const events = inspector.getEvents();
    expect(events[0]!.event).toEqual({ type: 'text-delta', text: 'second' });
    // Index resets to 0 on new stream
    expect(events[0]!.index).toBe(0);
  });

  it('exposeGlobal sets window.__STORE_AI_DEVTOOLS__', () => {
    const { inspector } = devtools({ exposeGlobal: true });
    const g = globalThis as Record<string, unknown>;
    expect(g.__STORE_AI_DEVTOOLS__).toBe(inspector);
  });

  it('exposeGlobal with multiple stores creates an array', () => {
    const { inspector: inspector1 } = devtools({ exposeGlobal: true, name: 'store1' });
    const { inspector: inspector2 } = devtools({ exposeGlobal: true, name: 'store2' });

    const g = globalThis as Record<string, unknown>;
    expect(Array.isArray(g.__STORE_AI_DEVTOOLS__)).toBe(true);

    const arr = g.__STORE_AI_DEVTOOLS__ as DevToolsInspector[];
    expect(arr).toContain(inspector1);
    expect(arr).toContain(inspector2);
  });

  it('state snapshots capture state at event time', async () => {
    const { middleware, inspector } = devtools();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [middleware],
    });

    async function* stream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
      yield { type: 'text-delta', text: ' world' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream() });
    await waitForStream();

    const events = inspector.getEvents();
    // ctx.state is set when the middleware context is created (before the
    // chain runs), so each snapshot shows state that includes all events
    // processed before this one.  The first event sees the initial
    // "streaming" state; the second sees state after "hello" was applied.
    expect(events[0]!.stateAfter.status).toBe('streaming');
    expect(events[1]!.stateAfter.text).toBe('hello');
    expect(events[2]!.stateAfter.text).toBe('hello world');
  });
});
