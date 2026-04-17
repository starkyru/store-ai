import type { MiddlewareContext, MiddlewareFn, StreamEvent } from '../types.js';

export function mapEvents(fn: (event: StreamEvent) => StreamEvent | null): MiddlewareFn {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const result = fn(ctx.event);
    if (result === null) {
      // Suppress the event: do not call next()
      return;
    }
    ctx.event = result;
    await next();
  };
}
