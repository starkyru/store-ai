# Middleware

Middleware intercepts stream events flowing through the pipeline. Each middleware can observe, transform, delay, or suppress events.

## Using Middleware

Pass middleware to `createAIStore`:

```typescript
import { createAIStore, logging, throttle, anthropic } from '@store-ai/core';

const store = createAIStore({
  provider: anthropic(),
  middleware: [logging({ level: 'debug' }), throttle(16)],
});
```

Or add middleware at runtime:

```typescript
const unsub = store.use(myMiddleware);
// Remove later
unsub();
```

## Built-in Middleware

| Middleware                                                            | Description                                                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `logging(opts?)`                                                      | Log stream lifecycle. `'debug'` logs all events; `'info'` (default) logs start/complete/error. |
| `validateSchema(schema)`                                              | Incremental Zod validation for structured output.                                              |
| `throttle(ms)`                                                        | Rate-limits delta events. Non-delta events pass through immediately.                           |
| `persist(storage, chatId?)`                                           | Saves messages on completion. Use with `restoreChat()` / `listChats()`.                        |
| `retryOn({ maxRetries, delay, filter? })`                             | Auto-retry on transient errors.                                                                |
| `trackCost({ inputCostPer1k, outputCostPer1k, reasoningCostPer1k? })` | Calculates token costs from usage events.                                                      |
| `mapEvents(fn)`                                                       | Transform or filter events. Return `null` to suppress.                                         |

## Writing Custom Middleware

### Function Form

The simplest form is a function that receives a context object and a `next` function:

```typescript
const myMiddleware = async (ctx, next) => {
  console.log('Before:', ctx.event.type);
  await next(); // pass to next middleware, then state reducer
  console.log('After:', ctx.event.type);
};
```

If you don't call `next()`, the event is suppressed and never reaches the state reducer:

```typescript
const noThinking = async (ctx, next) => {
  if (ctx.event.type !== 'thinking-delta') {
    await next();
  }
};
```

### Object Form

For lifecycle hooks, use the object form:

```typescript
const myMiddleware = {
  name: 'my-middleware',
  onStart({ state, store }) {
    console.log('Stream started');
  },
  onEvent: async (ctx, next) => {
    if (ctx.event.type === 'text-delta') {
      ctx.event = { ...ctx.event, text: ctx.event.text.toUpperCase() };
    }
    await next();
  },
  onComplete({ state }) {
    console.log('Done! Final text:', state.text);
  },
  onError(error) {
    reportToSentry(error);
  },
};
```

### Context Object

The middleware context provides:

```typescript
interface MiddlewareContext {
  event: StreamEvent; // the current event (mutable)
  state: Readonly<AIState>; // current store state snapshot
  store: AIStore; // full store reference
  metadata: Map<string, unknown>; // shared data between middleware for this stream
}
```

## Execution Order

Middleware executes in the order you provide them, using an onion model:

```
Event arrives
  -> middleware[0].onEvent(ctx, next)
    -> middleware[1].onEvent(ctx, next)
      -> middleware[2].onEvent(ctx, next)
        -> state reducer
      <- returns
    <- returns
  <- returns
```

## Next Steps

- [Structured Output](/guide/structured-output) -- using `validateSchema` middleware
- [Persistence](/guide/persistence) -- using `persist` middleware
- See the [API reference](/api/middleware) for full middleware signatures
