import type { AIState, MiddlewareContext, MiddlewareObject, StreamEvent } from '../types.js';

export interface LoggingOptions {
  level?: 'debug' | 'info';
  filter?: (event: StreamEvent) => boolean;
  logger?: { log: (...args: any[]) => void; debug: (...args: any[]) => void };
}

export function logging(opts?: LoggingOptions): MiddlewareObject {
  const level = opts?.level ?? 'info';
  const filter = opts?.filter;
  const logger = opts?.logger ?? console;

  function formatEvent(event: StreamEvent): string {
    switch (event.type) {
      case 'text-delta':
        return `[event] text-delta: "${event.text}"`;
      case 'thinking-delta':
        return `[event] thinking-delta: "${event.text}"`;
      case 'tool-call-start':
        return `[event] tool-call-start: ${event.name} (${event.id})`;
      case 'tool-call-delta':
        return `[event] tool-call-delta: ${event.id}`;
      case 'tool-call-end':
        return `[event] tool-call-end: ${event.id}`;
      case 'object-delta':
        return `[event] object-delta`;
      case 'usage':
        return `[event] usage`;
      case 'metadata':
        return `[event] metadata: ${event.key}`;
      case 'error':
        return `[event] error: ${event.error.message.slice(0, 120)}`;
      case 'finish':
        return `[event] finish: ${event.reason}`;
      case 'step-start':
        return `[event] step-start: ${event.stepId}`;
      case 'step-end':
        return `[event] step-end: ${event.stepId}`;
      default:
        return `[event] ${(event as StreamEvent).type}`;
    }
  }

  return {
    name: 'logging',

    onStart(_ctx: { state: Readonly<AIState> }) {
      logger.log('[store-ai] Stream started');
    },

    async onEvent(ctx: MiddlewareContext, next: () => Promise<void>) {
      if (level === 'debug') {
        const shouldLog = filter ? filter(ctx.event) : true;
        if (shouldLog) {
          logger.debug(`[store-ai] ${formatEvent(ctx.event)}`);
        }
      }
      await next();
    },

    onComplete(_ctx: { state: Readonly<AIState> }) {
      logger.log('[store-ai] Stream complete');
    },

    onError(error: Error, _ctx: { state: Readonly<AIState> }) {
      logger.log('[store-ai] Stream error:', error.message);
    },
  };
}
