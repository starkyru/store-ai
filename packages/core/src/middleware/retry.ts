import type { MiddlewareContext, MiddlewareObject } from '../types.js';

/** Configuration for the {@link retryOn} middleware. */
export interface RetryOptions {
  /** Maximum number of retry attempts before allowing the error to propagate. */
  maxRetries: number;
  /** Delay in milliseconds between retry attempts. */
  delay: number;
  /** Optional filter — only errors where `filter(error)` returns true trigger a retry. Defaults to retrying all errors. */
  filter?: (error: Error) => boolean;
}

/**
 * Middleware that suppresses error events when retries remain, signaling the
 * store to retry via metadata flags (`_retry`, `_retryDelay`, `_retryCount`).
 *
 * When retries are exhausted or the filter rejects the error, the error event
 * passes through normally. The retry counter resets on successful completion
 * or terminal error.
 *
 * @example
 * ```ts
 * const store = createAIStore({
 *   middleware: [
 *     retryOn({
 *       maxRetries: 3,
 *       delay: 1000,
 *       filter: (err) => err.message.includes('rate limit'),
 *     }),
 *   ],
 * });
 * ```
 */
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
