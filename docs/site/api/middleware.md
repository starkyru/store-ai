# Middleware API

Full API reference for built-in middleware.

## `logging(opts?)`

Log stream lifecycle events to the console.

```typescript
function logging(opts?: {
  level?: 'debug' | 'info'; // default: 'info'
  filter?: (event: StreamEvent) => boolean;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}): Middleware;
```

- `'info'` level logs start, complete, and error events.
- `'debug'` level logs every event.
- `filter` lets you suppress specific event types from logging.

## `validateSchema(schema)`

Incremental Zod validation for structured output.

```typescript
function validateSchema<T>(schema: ZodType<T>): Middleware;
```

Emits `object-delta` events that populate `partialObject` during streaming. Validates the final result against the full schema on completion, setting `object`.

## `throttle(ms)`

Rate-limits `text-delta` and `thinking-delta` events.

```typescript
function throttle(ms: number): Middleware;
```

Non-delta events (tool calls, usage, finish) pass through immediately. Flushes any buffered delta on stream completion.

## `persist(storage, chatId?)`

Saves messages to a storage adapter on stream completion.

```typescript
function persist(storage: StorageAdapter, chatId?: string): Middleware;
```

Use `restoreChat()`, `listChats()`, and `deleteChat()` from `@store-ai/core` to manage persisted data.

## `retryOn(opts)`

Automatically retry on transient errors.

```typescript
function retryOn(opts: {
  maxRetries: number;
  delay: number; // milliseconds between retries
  filter?: (error: Error) => boolean; // only retry matching errors
}): Middleware;
```

Suppresses error events when retries remain. Resets the retry counter on success or when the filter rejects an error.

## `trackCost(pricing)`

Calculate token costs from usage events.

```typescript
function trackCost(pricing: {
  inputCostPer1k: number;
  outputCostPer1k: number;
  reasoningCostPer1k?: number; // defaults to outputCostPer1k
}): Middleware;
```

After a usage event, cost is available via `ctx.metadata.get('cost')` returning a `CostInfo` object:

```typescript
interface CostInfo {
  inputCost: number;
  outputCost: number;
  reasoningCost: number;
  totalCost: number;
}
```

## `mapEvents(fn)`

Transform or filter stream events.

```typescript
function mapEvents(fn: (event: StreamEvent) => StreamEvent | null): Middleware;
```

Return the event (possibly modified) to pass it through. Return `null` to suppress it.

## Custom Middleware Types

```typescript
type MiddlewareFn = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void> | void;

interface MiddlewareObject {
  name?: string;
  onStart?(ctx: { state: AIState; store: AIStore }): void | Promise<void>;
  onEvent?: MiddlewareFn;
  onComplete?(ctx: { state: AIState; store: AIStore }): void | Promise<void>;
  onError?(error: Error, ctx: { state: AIState; store: AIStore }): void | Promise<void>;
  onAbort?(ctx: { state: AIState; store: AIStore }): void | Promise<void>;
}

type Middleware = MiddlewareFn | MiddlewareObject;

interface MiddlewareContext {
  event: StreamEvent;
  state: Readonly<AIState>;
  store: AIStore;
  metadata: Map<string, unknown>;
}
```
