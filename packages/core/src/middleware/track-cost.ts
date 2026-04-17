import type { MiddlewareContext, MiddlewareObject } from '../types.js';

/**
 * Token pricing for a specific AI provider/model.
 * Costs are in dollars per 1,000 tokens.
 */
export interface ProviderPricing {
  /** Cost per 1,000 input (prompt) tokens. */
  inputCostPer1k: number;
  /** Cost per 1,000 output (completion) tokens. */
  outputCostPer1k: number;
  /** Cost per 1,000 reasoning tokens. Defaults to `outputCostPer1k` if omitted. */
  reasoningCostPer1k?: number;
}

/** Calculated cost breakdown set on `ctx.metadata.get('cost')` by {@link trackCost}. */
export interface CostInfo {
  inputCost: number;
  outputCost: number;
  reasoningCost: number;
  totalCost: number;
}

/**
 * Middleware that calculates token costs from usage events and stores the
 * result in `ctx.metadata` under the key `"cost"`.
 *
 * Read the cost after streaming via a custom middleware or by inspecting
 * metadata in an `onComplete` hook.
 *
 * @example
 * ```ts
 * const store = createAIStore({
 *   middleware: [
 *     trackCost({
 *       inputCostPer1k: 0.003,    // $3 / 1M input tokens
 *       outputCostPer1k: 0.015,   // $15 / 1M output tokens
 *       reasoningCostPer1k: 0.015,
 *     }),
 *   ],
 * });
 * ```
 */
export function trackCost(pricing: ProviderPricing): MiddlewareObject {
  let cost: CostInfo = { inputCost: 0, outputCost: 0, reasoningCost: 0, totalCost: 0 };

  return {
    name: 'track-cost',

    onStart() {
      cost = { inputCost: 0, outputCost: 0, reasoningCost: 0, totalCost: 0 };
    },

    async onEvent(ctx: MiddlewareContext, next: () => Promise<void>) {
      if (ctx.event.type === 'usage') {
        const usage = ctx.event.usage;
        const reasoningRate = pricing.reasoningCostPer1k ?? pricing.outputCostPer1k;

        const inputCost = ((usage.inputTokens ?? 0) / 1000) * pricing.inputCostPer1k;
        const outputCost = ((usage.outputTokens ?? 0) / 1000) * pricing.outputCostPer1k;
        const reasoningCost = ((usage.reasoningTokens ?? 0) / 1000) * reasoningRate;

        cost = {
          inputCost,
          outputCost,
          reasoningCost,
          totalCost: inputCost + outputCost + reasoningCost,
        };

        ctx.metadata.set('cost', { ...cost });
      }
      await next();
    },

    onComplete() {
      // Final cost was already set on ctx.metadata during the last usage event.
      // Consumers can read it from the metadata map during onEvent processing.
    },
  };
}
