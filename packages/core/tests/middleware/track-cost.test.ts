import { describe, it, expect } from 'vitest';
import { createAIStore } from '../../src/store.js';
import { trackCost } from '../../src/middleware/track-cost.js';
import type { StreamEvent, MiddlewareContext } from '../../src/types.js';
import type { CostInfo } from '../../src/middleware/track-cost.js';

// ── Helpers ──

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('trackCost middleware', () => {
  it('calculates costs correctly from usage events', async () => {
    let capturedCost: CostInfo | undefined;

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        trackCost({
          inputCostPer1k: 0.003, // $3 per 1M input
          outputCostPer1k: 0.015, // $15 per 1M output
        }),
        // Capture middleware to read the cost metadata
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          if (ctx.metadata.has('cost')) {
            capturedCost = ctx.metadata.get('cost') as CostInfo;
          }
          await next();
        },
      ],
    });

    async function* usageStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
      yield {
        type: 'usage',
        usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 0 },
      };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: usageStream() });
    await waitForStream();

    expect(capturedCost).toBeDefined();
    expect(capturedCost!.inputCost).toBeCloseTo(0.003); // 1000/1000 * 0.003
    expect(capturedCost!.outputCost).toBeCloseTo(0.0075); // 500/1000 * 0.015
    expect(capturedCost!.reasoningCost).toBe(0);
    expect(capturedCost!.totalCost).toBeCloseTo(0.0105);
  });

  it('handles missing reasoning tokens (falls back to output pricing)', async () => {
    let capturedCost: CostInfo | undefined;

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        trackCost({
          inputCostPer1k: 0.003,
          outputCostPer1k: 0.015,
          // no reasoningCostPer1k — should fall back to outputCostPer1k
        }),
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          if (ctx.metadata.has('cost')) {
            capturedCost = ctx.metadata.get('cost') as CostInfo;
          }
          await next();
        },
      ],
    });

    async function* usageStream(): AsyncGenerator<StreamEvent> {
      yield {
        type: 'usage',
        usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 300 },
      };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: usageStream() });
    await waitForStream();

    expect(capturedCost).toBeDefined();
    // reasoningCost should use outputCostPer1k: 300/1000 * 0.015 = 0.0045
    expect(capturedCost!.reasoningCost).toBeCloseTo(0.0045);
    expect(capturedCost!.totalCost).toBeCloseTo(
      0.003 + // input: 1000/1000 * 0.003
        0.003 + // output: 200/1000 * 0.015
        0.0045, // reasoning: 300/1000 * 0.015
    );
  });

  it('uses explicit reasoning pricing when provided', async () => {
    let capturedCost: CostInfo | undefined;

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        trackCost({
          inputCostPer1k: 0.003,
          outputCostPer1k: 0.015,
          reasoningCostPer1k: 0.06, // explicit reasoning rate
        }),
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          if (ctx.metadata.has('cost')) {
            capturedCost = ctx.metadata.get('cost') as CostInfo;
          }
          await next();
        },
      ],
    });

    async function* usageStream(): AsyncGenerator<StreamEvent> {
      yield {
        type: 'usage',
        usage: { inputTokens: 1000, outputTokens: 200, reasoningTokens: 300 },
      };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: usageStream() });
    await waitForStream();

    expect(capturedCost).toBeDefined();
    // reasoningCost should use explicit rate: 300/1000 * 0.06 = 0.018
    expect(capturedCost!.reasoningCost).toBeCloseTo(0.018);
  });

  it('zero tokens = zero cost', async () => {
    let capturedCost: CostInfo | undefined;

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        trackCost({
          inputCostPer1k: 0.003,
          outputCostPer1k: 0.015,
        }),
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          if (ctx.metadata.has('cost')) {
            capturedCost = ctx.metadata.get('cost') as CostInfo;
          }
          await next();
        },
      ],
    });

    async function* usageStream(): AsyncGenerator<StreamEvent> {
      yield {
        type: 'usage',
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: usageStream() });
    await waitForStream();

    expect(capturedCost).toBeDefined();
    expect(capturedCost!.inputCost).toBe(0);
    expect(capturedCost!.outputCost).toBe(0);
    expect(capturedCost!.reasoningCost).toBe(0);
    expect(capturedCost!.totalCost).toBe(0);
  });

  it('cost metadata is set correctly on the context', async () => {
    let capturedCost: CostInfo | undefined;

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        trackCost({
          inputCostPer1k: 0.01,
          outputCostPer1k: 0.03,
        }),
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          if (ctx.metadata.has('cost')) {
            capturedCost = ctx.metadata.get('cost') as CostInfo;
          }
          await next();
        },
      ],
    });

    async function* usageStream(): AsyncGenerator<StreamEvent> {
      yield {
        type: 'usage',
        usage: { inputTokens: 500, outputTokens: 250, reasoningTokens: 0 },
      };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: usageStream() });
    await waitForStream();

    expect(capturedCost).toBeDefined();
    expect(typeof capturedCost!.inputCost).toBe('number');
    expect(typeof capturedCost!.outputCost).toBe('number');
    expect(typeof capturedCost!.reasoningCost).toBe('number');
    expect(typeof capturedCost!.totalCost).toBe('number');
    expect(capturedCost!.totalCost).toBe(
      capturedCost!.inputCost + capturedCost!.outputCost + capturedCost!.reasoningCost,
    );
  });

  it('resets cost on new stream start', async () => {
    let capturedCost: CostInfo | undefined;

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [
        trackCost({
          inputCostPer1k: 0.003,
          outputCostPer1k: 0.015,
        }),
        async (ctx: MiddlewareContext, next: () => Promise<void>) => {
          if (ctx.metadata.has('cost')) {
            capturedCost = ctx.metadata.get('cost') as CostInfo;
          }
          await next();
        },
      ],
    });

    // First stream with usage
    async function* stream1(): AsyncGenerator<StreamEvent> {
      yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 1000 } };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream1() });
    await waitForStream();

    const firstCost = capturedCost!.totalCost;
    expect(firstCost).toBeGreaterThan(0);

    // Second stream with different usage
    async function* stream2(): AsyncGenerator<StreamEvent> {
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: stream2() });
    await waitForStream();

    // Cost should reflect only the second stream
    expect(capturedCost!.totalCost).toBeLessThan(firstCost);
  });
});
