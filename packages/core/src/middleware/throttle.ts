import type { MiddlewareContext, MiddlewareFn } from '../types.js';

/**
 * Maximum size for buffered delta text (256 KB).
 * If the buffer exceeds this, it is flushed immediately to prevent unbounded memory growth.
 */
const MAX_PENDING_SIZE = 256 * 1024;

export function throttle(ms: number): MiddlewareFn {
  let lastTextTime = 0;
  let lastThinkingTime = 0;
  let pendingTextDelta: string | null = null;
  let pendingThinkingDelta: string | null = null;

  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const { event } = ctx;

    if (event.type === 'text-delta') {
      const now = Date.now();
      const elapsed = now - lastTextTime;
      const bufferExceeded =
        pendingTextDelta !== null && pendingTextDelta.length + event.text.length > MAX_PENDING_SIZE;

      if (lastTextTime === 0 || elapsed >= ms || bufferExceeded) {
        // First event, enough time has passed, or buffer would overflow: forward immediately
        if (pendingTextDelta !== null) {
          // Flush any buffered delta first, combined with current
          ctx.event = { type: 'text-delta', text: pendingTextDelta + event.text };
          pendingTextDelta = null;
        }
        lastTextTime = now;
        await next();
      } else {
        // Buffer this delta
        pendingTextDelta = (pendingTextDelta ?? '') + event.text;
      }
      return;
    }

    if (event.type === 'thinking-delta') {
      const now = Date.now();
      const elapsed = now - lastThinkingTime;
      const bufferExceeded =
        pendingThinkingDelta !== null &&
        pendingThinkingDelta.length + event.text.length > MAX_PENDING_SIZE;

      if (lastThinkingTime === 0 || elapsed >= ms || bufferExceeded) {
        if (pendingThinkingDelta !== null) {
          ctx.event = { type: 'thinking-delta', text: pendingThinkingDelta + event.text };
          pendingThinkingDelta = null;
        }
        lastThinkingTime = now;
        await next();
      } else {
        pendingThinkingDelta = (pendingThinkingDelta ?? '') + event.text;
      }
      return;
    }

    // On finish or error, flush any buffered deltas before forwarding
    if (event.type === 'finish' || event.type === 'error') {
      if (pendingTextDelta !== null) {
        const flushedText = pendingTextDelta;
        pendingTextDelta = null;
        const originalEvent = ctx.event;
        ctx.event = { type: 'text-delta', text: flushedText };
        await next();
        ctx.event = originalEvent;
      }
      if (pendingThinkingDelta !== null) {
        const flushedThinking = pendingThinkingDelta;
        pendingThinkingDelta = null;
        const originalEvent = ctx.event;
        ctx.event = { type: 'thinking-delta', text: flushedThinking };
        await next();
        ctx.event = originalEvent;
      }
    }

    // Always forward non-delta events immediately
    await next();
  };
}
