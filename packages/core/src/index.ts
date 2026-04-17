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

// ── Provider adapters ──
export { anthropic } from './providers/anthropic.js';
export { openai } from './providers/openai.js';
