// ── Core store ──
export { createAIStore } from './store.js';
export type { AIStore } from './store.js';

// ── Types ──
export type {
  AIState,
  AIFullState,
  AIComputedState,
  AIStatus,
  AIStoreOptions,
  BatchStrategy,
  Message,
  MessageContent,
  MessageRole,
  ToolCallState,
  ToolCallStatus,
  TokenUsage,
  LatencyInfo,
  StreamEvent,
  FinishReason,
  StoreAction,
  StreamMeta,
  SSEEvent,
  ProviderAdapter,
  Middleware,
  MiddlewareFn,
  MiddlewareObject,
  MiddlewareContext,
  StreamHandle,
  SubmitInput,
  StoreAdapterResult,
  StorageAdapter,
  SerializedChat,
  ChatInfo,
  DeepPartial,
} from './types.js';

// ── Reducer (for testing / advanced usage) ──
export { aiReducer, getInitialState } from './reducer.js';

// ── Parsers ──
export { createSSEParser } from './parsers/sse.js';
export { createNDJSONParser } from './parsers/ndjson.js';
export { createPartialJSONParser } from './parsers/partial-json.js';
export type { PartialJSONParser } from './parsers/partial-json.js';

// ── Provider adapters ──
export { anthropic } from './providers/anthropic.js';
export { openai } from './providers/openai.js';
export { openaiResponses } from './providers/openai-responses.js';

// ── Built-in middleware ──
export { logging } from './middleware/logging.js';
export type { LoggingOptions } from './middleware/logging.js';
export { throttle } from './middleware/throttle.js';
export { mapEvents } from './middleware/map-events.js';
export { validateSchema } from './middleware/validate-schema.js';
export { persist, restoreChat, listChats, deleteChat } from './middleware/persist.js';
export { retryOn } from './middleware/retry.js';
export type { RetryOptions } from './middleware/retry.js';
export { trackCost } from './middleware/track-cost.js';
export type { ProviderPricing, CostInfo } from './middleware/track-cost.js';

// ── Storage adapters ──
export { memoryStorage } from './storage/memory.js';
export { localStorageAdapter } from './storage/local-storage.js';
export { indexedDBAdapter } from './storage/indexed-db.js';
