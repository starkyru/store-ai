// ── Deep utility types ──

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// ── Message types ──

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCall: ToolCallState }
  | { type: 'tool-result'; toolCallId: string; result: unknown }
  | { type: 'thinking'; text: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'file'; url: string; mimeType: string; name?: string };

export interface Message {
  id: string;
  role: MessageRole;
  content: MessageContent[];
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

// ── Tool calls ──

export type ToolCallStatus = 'pending' | 'partial' | 'complete' | 'error';

export interface ToolCallState {
  id: string;
  name: string;
  status: ToolCallStatus;
  input: unknown;
  inputText: string;
  output: unknown | null;
  error: Error | null;
  startedAt: Date;
  completedAt: Date | null;
}

// ── Metadata ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface LatencyInfo {
  startMs: number;
  firstTokenMs: number | null;
  endMs: number | null;
  ttft: number | null;
  totalMs: number | null;
}

// ── Core state ──

export type AIStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error' | 'aborted';

export interface AIState<TStructured = unknown> {
  status: AIStatus;
  error: Error | null;

  text: string;
  textDelta: string;

  messages: Message[];
  lastMessage: Message | null;

  partialObject: DeepPartial<TStructured> | null;
  object: TStructured | null;

  toolCalls: ToolCallState[];

  thinking: string;
  thinkingDelta: string;

  usage: TokenUsage | null;
  latency: LatencyInfo | null;
  model: string | null;
  provider: string | null;
}

// ── Computed selectors (derived from AIState) ──

export interface AIComputedState {
  isStreaming: boolean;
  isIdle: boolean;
  isError: boolean;
  hasMessages: boolean;
  pendingToolCalls: ToolCallState[];
  completedToolCalls: ToolCallState[];
}

export type AIFullState<T = unknown> = AIState<T> & AIComputedState;

// ── Stream events (unified across providers) ──

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id: string; inputDelta: string }
  | { type: 'tool-call-end'; id: string; input: unknown }
  | { type: 'object-delta'; text: string; partial: DeepPartial<unknown> | null }
  | { type: 'usage'; usage: Partial<TokenUsage> }
  | { type: 'metadata'; key: string; value: unknown }
  | { type: 'error'; error: Error }
  | { type: 'finish'; reason: FinishReason }
  | { type: 'step-start'; stepId: string }
  | { type: 'step-end'; stepId: string };

export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'error';

export const STREAM_EVENT_TYPES: ReadonlySet<string> = new Set([
  'text-delta',
  'thinking-delta',
  'tool-call-start',
  'tool-call-delta',
  'tool-call-end',
  'object-delta',
  'usage',
  'metadata',
  'error',
  'finish',
  'step-start',
  'step-end',
]);

// ── Store actions (internal reducer) ──

export type StoreAction =
  | { type: 'stream/start'; meta?: StreamMeta }
  | { type: 'stream/text-delta'; delta: string }
  | { type: 'stream/thinking-delta'; delta: string }
  | { type: 'stream/tool-call-start'; id: string; name: string }
  | { type: 'stream/tool-call-delta'; toolCallId: string; inputDelta: string }
  | { type: 'stream/tool-call-complete'; toolCallId: string; input: unknown }
  | { type: 'stream/object-delta'; partial: DeepPartial<unknown> }
  | { type: 'stream/usage'; usage: TokenUsage }
  | { type: 'stream/complete'; usage?: TokenUsage }
  | { type: 'stream/error'; error: Error }
  | { type: 'stream/abort' }
  | { type: 'messages/set'; messages: Message[] }
  | { type: 'messages/append'; message: Message }
  | { type: 'tool/result'; toolCallId: string; result: unknown }
  | { type: 'reset' };

export interface StreamMeta {
  model?: string;
  provider?: string;
}

// ── SSE types ──

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

// ── Provider adapter ──

export interface ProviderAdapter {
  name: string;
  createTransform(): TransformStream<SSEEvent, StreamEvent>;
}

// ── Middleware ──

export interface MiddlewareContext {
  event: StreamEvent;
  state: Readonly<AIState>;
  metadata: Map<string, unknown>;
}

export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: () => Promise<void>,
) => Promise<void> | void;

export interface MiddlewareObject {
  name?: string;
  onStart?(ctx: { state: Readonly<AIState> }): void | Promise<void>;
  onEvent?: MiddlewareFn;
  onComplete?(ctx: { state: Readonly<AIState> }): void | Promise<void>;
  onError?(error: Error, ctx: { state: Readonly<AIState> }): void | Promise<void>;
  onAbort?(ctx: { state: Readonly<AIState> }): void | Promise<void>;
}

export type Middleware = MiddlewareFn | MiddlewareObject;

// ── Stream handle ──

export interface StreamHandle {
  abort(): void;
  signal: AbortSignal;
}

// ── Submit input ──

export interface SubmitInput {
  messages?: Message[];
  message?: string;
  stream?: ReadableStream<Uint8Array>;
  events?: ReadableStream<StreamEvent> | AsyncIterable<StreamEvent>;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

// ── Store options ──

export type BatchStrategy = 'microtask' | 'raf' | 'sync' | ((notify: () => void) => void);

export interface AIStoreOptions<_T = unknown> {
  provider?: ProviderAdapter;
  middleware?: Middleware[];
  initialMessages?: Message[];
  batchStrategy?: BatchStrategy;
}

// ── Store adapter interface ──

export interface StoreAdapterResult<TStore> {
  store: TStore;
  destroy(): void;
}

// ── Storage adapter (for persistence middleware) ──

export interface SerializedChat {
  id: string;
  messages: Message[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StorageAdapter {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

// ── Chat manager ──

export interface ChatInfo {
  id: string;
  title: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  status: AIStatus;
}
