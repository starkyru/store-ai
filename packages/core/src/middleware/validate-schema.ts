import type { AIState, MiddlewareContext, MiddlewareObject } from '../types.js';
import { createPartialJSONParser } from '../parsers/partial-json.js';
import type { PartialJSONParser } from '../parsers/partial-json.js';

/**
 * Zod-compatible schema interface.
 * We only require `parse` and `safeParse` so callers aren't forced to import zod at runtime
 * (zod is an optional peer dependency).
 */
interface SchemaLike<T> {
  parse(data: unknown): T;
  safeParse(data: unknown): { success: boolean; data?: T; error?: unknown };
}

export function validateSchema<T>(schema: SchemaLike<T>): MiddlewareObject {
  let parser: PartialJSONParser<T>;

  return {
    name: 'validateSchema',

    onStart(_ctx: { state: Readonly<AIState> }) {
      parser = createPartialJSONParser<T>();
    },

    async onEvent(ctx: MiddlewareContext, next: () => Promise<void>) {
      const { event } = ctx;

      if (event.type === 'text-delta') {
        // 1. Pass through the original text-delta so text accumulates in state
        await next();

        // 2. Feed the text chunk to the partial JSON parser
        parser.push(event.text);
        const partial = parser.getPartial();

        if (partial !== null) {
          // 3. Emit a synthetic object-delta event using the same pattern as
          //    the throttle middleware: swap ctx.event and call next() again.
          const originalEvent = ctx.event;
          ctx.event = { type: 'object-delta', text: event.text, partial };
          await next();
          ctx.event = originalEvent;
        }
        return;
      }

      if (event.type === 'finish') {
        // Validate the final object against the schema before passing finish through.
        // We do this here rather than in onComplete because onComplete only fires
        // when the stream ends without a finish event (natural end fallback).
        if (parser) {
          const final = parser.getFinal();
          if (final !== null) {
            const result = schema.safeParse(final);
            if (!result.success) {
              console.warn('[store-ai:validateSchema] Final object failed schema validation.');
            }
          }
        }
        await next();
        return;
      }

      // All other events pass through normally
      await next();
    },

    onComplete(_ctx: { state: Readonly<AIState> }) {
      // Fallback validation for streams that end without a finish event
      if (!parser) return;
      const final = parser.getFinal();
      if (final !== null) {
        const result = schema.safeParse(final);
        if (!result.success) {
          console.warn('[store-ai:validateSchema] Final object failed schema validation.');
        }
      }
    },

    onError(_error: Error, _ctx: { state: Readonly<AIState> }) {
      // Reset parser on error to free memory
      if (parser) parser.reset();
    },

    onAbort(_ctx: { state: Readonly<AIState> }) {
      // Reset parser on abort to free memory
      if (parser) parser.reset();
    },
  };
}
