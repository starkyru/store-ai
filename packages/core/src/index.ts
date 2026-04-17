// ── Core store ──
export { createAIStore } from './store.js';
export type { AIStore } from './store.js';

// ── Chat manager ──
export { createChatManager } from './chat-manager.js';
export type { ChatManager, ChatManagerOptions } from './chat-manager.js';

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
  CompleteResponse,
  StoreAdapterResult,
  StorageAdapter,
  SerializedChat,
  ChatInfo,
  DeepPartial,
} from './types.js';

// ── Message tree ──
export { createMessageTree } from './message-tree.js';
export type { MessageTree, MessageNode } from './message-tree.js';

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
export { aiSdkDataStream } from './providers/ai-sdk-data-stream.js';
export { agUI } from './providers/ag-ui.js';

// ── Built-in middleware ──
export { logging } from './middleware/logging.js';
export type { LoggingOptions } from './middleware/logging.js';
export { devtools } from './middleware/devtools.js';
export type { DevToolsEvent, DevToolsInspector, DevToolsOptions } from './middleware/devtools.js';
export { throttle } from './middleware/throttle.js';
export { mapEvents } from './middleware/map-events.js';
export { validateSchema } from './middleware/validate-schema.js';
export { persist, restoreChat, listChats, deleteChat } from './middleware/persist.js';
export { retryOn } from './middleware/retry.js';
export type { RetryOptions } from './middleware/retry.js';
export { resumable, getStreamCheckpoint, deleteStreamCheckpoint } from './middleware/resumable.js';
export type { ResumableOptions, StreamCheckpoint } from './middleware/resumable.js';
export { trackCost } from './middleware/track-cost.js';
export type { ProviderPricing, CostInfo } from './middleware/track-cost.js';

// ── Transports ──
export { createWebSocketTransport, submitViaWebSocket } from './transports/websocket.js';
export type { WebSocketTransportOptions } from './transports/websocket.js';

// ── Worker offloading ──
export { createWorkerStream } from './worker/create-worker-stream.js';
export { setupWorkerHandler } from './worker/worker-handler.js';
export type { WorkerStreamOptions } from './worker/create-worker-stream.js';
export type { WorkerRequest, WorkerResponse } from './worker/types.js';

// ── Generative UI ──
export { createUIRegistry, connectUI } from './generative-ui.js';
export type { UIElement, ToolRenderer, UIRegistry } from './generative-ui.js';

// ── Storage adapters ──
export { memoryStorage } from './storage/memory.js';
export { localStorageAdapter } from './storage/local-storage.js';
export { indexedDBAdapter } from './storage/indexed-db.js';
