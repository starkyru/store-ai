import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '../../src/store.js';
import { validateSchema } from '../../src/middleware/validate-schema.js';
import type { StreamEvent } from '../../src/types.js';

// Minimal zod-compatible schema for testing (avoids importing zod in tests)
function createMockSchema<T>(validator: (data: unknown) => data is T) {
  return {
    parse(data: unknown): T {
      if (validator(data)) return data;
      throw new Error('Schema validation failed');
    },
    safeParse(data: unknown): { success: boolean; data?: T; error?: unknown } {
      try {
        const result = this.parse(data);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: err };
      }
    },
  };
}

// ── Helpers ──

async function* textChunks(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('validateSchema middleware', () => {
  it('accumulates text-delta events and produces partialObject in state', async () => {
    const schema = createMockSchema(
      (d): d is { name: string } => typeof d === 'object' && d !== null && 'name' in d,
    );

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(schema)],
    });

    store.submit({
      events: textChunks(['{"na', 'me": "Al', 'ice"}']),
    });
    await waitForStream();

    // After streaming, partialObject should be populated
    expect(store.get('partialObject')).toEqual({ name: 'Alice' });
    // Text should also accumulate normally
    expect(store.get('text')).toBe('{"name": "Alice"}');
  });

  it('updates partialObject progressively during streaming', async () => {
    const schema = createMockSchema(
      (d): d is { name: string; age: number } => typeof d === 'object' && d !== null && 'name' in d,
    );

    const partials: unknown[] = [];

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(schema)],
    });

    store.subscribe('partialObject', (value) => {
      if (value !== null) {
        partials.push(structuredClone(value));
      }
    });

    store.submit({
      events: textChunks(['{"name": "Bo', 'b", "age": 2', '5}']),
    });
    await waitForStream();

    // We should see progressive updates
    expect(partials.length).toBeGreaterThanOrEqual(1);
    // Final partial should have both fields
    const last = partials[partials.length - 1] as Record<string, unknown>;
    expect(last).toHaveProperty('name', 'Bob');
    expect(last).toHaveProperty('age', 25);
  });

  it('final object matches schema after stream completion', async () => {
    const schema = createMockSchema(
      (d): d is { items: string[] } =>
        typeof d === 'object' && d !== null && 'items' in d && Array.isArray((d as any).items),
    );

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(schema)],
    });

    store.submit({
      events: textChunks(['{"items": ["a", "b", "c"]}']),
    });
    await waitForStream();

    expect(store.get('partialObject')).toEqual({ items: ['a', 'b', 'c'] });
    expect(store.get('status')).toBe('complete');
    // On completion, object is promoted from partialObject
    expect(store.get('object')).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('handles invalid final JSON gracefully (logs warning, does not crash)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Schema that rejects everything
    const strictSchema = {
      parse(_data: unknown): never {
        throw new Error('always fails');
      },
      safeParse(_data: unknown) {
        return { success: false as const, error: new Error('always fails') };
      },
    };

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(strictSchema)],
    });

    store.submit({
      events: textChunks(['{"key": "value"}']),
    });
    await waitForStream();

    // Should have logged a warning (without leaking the error object)
    expect(warnSpy).toHaveBeenCalled();
    const warnMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(warnMessage).toContain('validateSchema');
    // Ensure the actual error details are NOT leaked in the log
    expect(warnMessage).not.toContain('always fails');

    // Store should still be complete -- not crashed
    expect(store.get('status')).toBe('complete');
    expect(store.get('text')).toBe('{"key": "value"}');

    warnSpy.mockRestore();
  });

  it('text-delta events still pass through to accumulate text', async () => {
    const schema = createMockSchema(
      (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
    );

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(schema)],
    });

    const textDeltas: string[] = [];
    store.subscribe('textDelta', (value) => {
      if (value) textDeltas.push(value);
    });

    store.submit({
      events: textChunks(['{"a"', ': 1}']),
    });
    await waitForStream();

    // text-delta events should still fire
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    expect(store.get('text')).toBe('{"a": 1}');
  });

  it('handles empty stream without errors', async () => {
    const schema = createMockSchema(
      (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
    );

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(schema)],
    });

    async function* emptyStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: emptyStream() });
    await waitForStream();

    expect(store.get('partialObject')).toBeNull();
    expect(store.get('status')).toBe('complete');
  });

  it('resets parser on abort', async () => {
    const schema = createMockSchema(
      (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
    );

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [validateSchema(schema)],
    });

    let resolveBlock!: () => void;
    const block = new Promise<void>((r) => {
      resolveBlock = r;
    });

    async function* slowStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: '{"a": 1' };
      await block;
      yield { type: 'text-delta', text: '}' };
      yield { type: 'finish', reason: 'stop' };
    }

    const handle = store.submit({ events: slowStream() });
    // Give time for first chunk to process
    await new Promise<void>((r) => setTimeout(r, 20));

    handle.abort();
    resolveBlock();
    await waitForStream();

    expect(store.get('status')).toBe('aborted');
  });

  it('composes with other middleware', async () => {
    const schema = createMockSchema(
      (d): d is { value: string } => typeof d === 'object' && d !== null && 'value' in d,
    );

    const events: string[] = [];

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        // validateSchema is first: it passes through text-delta then emits object-delta
        validateSchema(schema),
        // Observer is after validateSchema in the chain, so it sees both
        // the original text-delta dispatch AND the synthetic object-delta dispatch
        async (ctx, next) => {
          events.push(ctx.event.type);
          await next();
        },
      ],
    });

    store.submit({
      events: textChunks(['{"value": "test"}']),
    });
    await waitForStream();

    // The observer (deeper in chain) sees text-delta, object-delta, and finish
    expect(events).toContain('text-delta');
    expect(events).toContain('object-delta');
    expect(events).toContain('finish');
  });
});
