import type { MiddlewareContext, MiddlewareObject } from '../types.js';

export interface RetryOptions {
  maxRetries: number;
  delay: number; // ms between retries
  filter?: (error: Error) => boolean; // only retry if filter returns true
}

export function retryOn(opts: RetryOptions): MiddlewareObject {
  let retryCount = 0;

  return {
    name: 'retry',

    onEvent: async (ctx: MiddlewareContext, next: () => Promise<void>) => {
      if (ctx.event.type === 'error') {
        const error = ctx.event.error;
        const shouldRetry =
          retryCount < opts.maxRetries && (opts.filter ? opts.filter(error) : true);

        if (shouldRetry) {
          retryCount++;
          ctx.metadata.set('_retry', true);
          ctx.metadata.set('_retryDelay', opts.delay);
          ctx.metadata.set('_retryCount', retryCount);
          // Don't call next() — suppress the error event
          return;
        }
      }
      await next();
    },

    onComplete() {
      retryCount = 0;
    },

    onError() {
      // Reset retry count when the stream terminates with an error so that
      // the next stream session starts with a full retry budget.
      retryCount = 0;
    },
  };
}
