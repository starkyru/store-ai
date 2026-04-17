import type { MiddlewareContext, MiddlewareObject } from '../types.js';

export interface ProviderPricing {
  inputCostPer1k: number; // $ per 1000 input tokens
  outputCostPer1k: number; // $ per 1000 output tokens
  reasoningCostPer1k?: number; // $ per 1000 reasoning tokens (defaults to outputCostPer1k)
}

export interface CostInfo {
  inputCost: number;
  outputCost: number;
  reasoningCost: number;
  totalCost: number;
}

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
