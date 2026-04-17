import type {
  AIFullState,
  AIState,
  AIStoreOptions,
  BatchStrategy,
  CompleteResponse,
  Message,
  Middleware,
  MiddlewareContext,
  MiddlewareFn,
  MiddlewareObject,
  StoreAction,
  StreamEvent,
  StreamHandle,
  SubmitInput,
} from './types.js';
import { aiReducer, getInitialState } from './reducer.js';
import { createSSEParser } from './parsers/sse.js';

type Listener<T> = (state: AIFullState<T>, prev: AIFullState<T>) => void;
type KeyListener<T, K extends keyof AIFullState<T>> = (
  value: AIFullState<T>[K],
  prev: AIFullState<T>[K],
) => void;

export interface AIStore<T = unknown> {
  get(): AIFullState<T>;
  get<K extends keyof AIFullState<T>>(key: K): AIFullState<T>[K];

  subscribe(listener: Listener<T>): () => void;
  subscribe<K extends keyof AIFullState<T>>(key: K, listener: KeyListener<T, K>): () => void;

  submit(input: SubmitInput): StreamHandle;
  abort(): void;
  reset(): void;
  setMessages(messages: Message[]): void;
  addToolResult(toolCallId: string, result: unknown): void;
  retry(): StreamHandle;

  use(middleware: Middleware): () => void;

  destroy(): void;
}

function computeDerived<T>(state: AIState<T>): AIFullState<T> {
  return {
    ...state,
    isStreaming: state.status === 'streaming',
    isIdle: state.status === 'idle',
    isError: state.status === 'error',
    hasMessages: state.messages.length > 0,
    pendingToolCalls: state.toolCalls.filter(
      (tc) => tc.status === 'pending' || tc.status === 'partial',
    ),
    completedToolCalls: state.toolCalls.filter((tc) => tc.status === 'complete'),
  };
}

function createBatcher(strategy: BatchStrategy): (notify: () => void) => void {
  if (typeof strategy === 'function') return strategy;
  switch (strategy) {
    case 'sync':
      return (notify) => notify();
    case 'raf':
      return (notify) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(notify);
        } else {
          notify();
        }
      };
    case 'microtask':
    default:
      return (notify) => queueMicrotask(notify);
  }
}

function isMiddlewareObject(mw: Middleware): mw is MiddlewareObject {
  return typeof mw === 'object' && mw !== null;
}

function getOnEvent(mw: Middleware): MiddlewareFn | undefined {
  if (typeof mw === 'function') return mw;
  return mw.onEvent;
}

async function* responseToEvents(response: CompleteResponse): AsyncGenerator<StreamEvent> {
  if (response.thinking) {
    yield { type: 'thinking-delta', text: response.thinking };
  }
  if (response.text) {
    yield { type: 'text-delta', text: response.text };
  }
  if (response.toolCalls) {
    for (const tc of response.toolCalls) {
      yield { type: 'tool-call-start', id: tc.id, name: tc.name };
      yield { type: 'tool-call-end', id: tc.id, input: tc.input };
    }
  }
  if (response.object !== undefined) {
    yield { type: 'object-delta', text: '', partial: response.object };
  }
  if (response.usage) {
    yield { type: 'usage', usage: response.usage };
  }
  yield { type: 'finish', reason: response.finishReason ?? 'stop' };
}

export function createAIStore<T = unknown>(options?: AIStoreOptions<T>): AIStore<T> {
  let rawState: AIState<T> = getInitialState<T>();
  let fullState: AIFullState<T> = computeDerived(rawState);
  let prevFullState: AIFullState<T> = fullState;

  // Restore initial messages if provided
  if (options?.initialMessages?.length) {
    rawState = aiReducer(rawState, { type: 'messages/set', messages: options.initialMessages });
    fullState = computeDerived(rawState);
    prevFullState = fullState;
  }

  const listeners = new Set<Listener<T>>();
  const keyListeners = new Map<keyof AIFullState<T>, Set<KeyListener<T, any>>>();
  const middlewares: Middleware[] = [...(options?.middleware ?? [])];

  const batch = createBatcher(options?.batchStrategy ?? 'microtask');
  let notificationPending = false;

  let activeAbort: AbortController | null = null;
  let lastInput: SubmitInput | null = null;
  let externalSignalCleanup: (() => void) | null = null;

  function notify() {
    if (notificationPending) return;
    notificationPending = true;

    batch(() => {
      notificationPending = false;
      const current = fullState;
      const prev = prevFullState;
      prevFullState = current;

      // Full-state listeners
      for (const listener of listeners) {
        listener(current, prev);
      }

      // Key-specific listeners
      for (const [key, keySet] of keyListeners) {
        if (current[key] !== prev[key]) {
          for (const listener of keySet) {
            listener(current[key], prev[key]);
          }
        }
      }
    });
  }

  function dispatch(action: StoreAction) {
    rawState = aiReducer(rawState, action);
    fullState = computeDerived(rawState);
    notify();
  }

  async function runMiddleware(event: StreamEvent): Promise<void> {
    const ctx: MiddlewareContext = {
      event,
      state: fullState,
      metadata: new Map(),
    };

    const fns = middlewares.map(getOnEvent).filter(Boolean) as MiddlewareFn[];

    const run = async (index: number): Promise<void> => {
      if (index >= fns.length) {
        // End of chain — dispatch to reducer
        dispatchStreamEvent(ctx.event);
        return;
      }
      await fns[index]!(ctx, () => run(index + 1));
    };

    await run(0);
  }

  function dispatchStreamEvent(event: StreamEvent) {
    switch (event.type) {
      case 'text-delta':
        dispatch({ type: 'stream/text-delta', delta: event.text });
        break;
      case 'thinking-delta':
        dispatch({ type: 'stream/thinking-delta', delta: event.text });
        break;
      case 'tool-call-start':
        dispatch({ type: 'stream/tool-call-start', id: event.id, name: event.name });
        break;
      case 'tool-call-delta':
        dispatch({
          type: 'stream/tool-call-delta',
          toolCallId: event.id,
          inputDelta: event.inputDelta,
        });
        break;
      case 'tool-call-end':
        dispatch({ type: 'stream/tool-call-complete', toolCallId: event.id, input: event.input });
        break;
      case 'object-delta':
        dispatch({ type: 'stream/object-delta', partial: event.partial ?? {} });
        break;
      case 'usage':
        // Merge partial usage into state without triggering completion
        if (event.usage) {
          const current = rawState.usage ?? {
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
          };
          dispatch({
            type: 'stream/usage',
            usage: {
              ...current,
              ...event.usage,
              totalTokens:
                (event.usage.inputTokens ?? current.inputTokens) +
                (event.usage.outputTokens ?? current.outputTokens) +
                (event.usage.reasoningTokens ?? current.reasoningTokens),
            },
          });
        }
        break;
      case 'error':
        dispatch({ type: 'stream/error', error: event.error });
        break;
      case 'finish':
        dispatch({ type: 'stream/complete' });
        break;
      // step-start, step-end, metadata — no default reducer action for now
    }
  }

  async function consumeStream(
    eventSource: ReadableStream<StreamEvent> | AsyncIterable<StreamEvent>,
    signal: AbortSignal,
  ): Promise<void> {
    // Notify middleware of stream start
    for (const mw of middlewares) {
      if (isMiddlewareObject(mw) && mw.onStart) {
        await mw.onStart({ state: fullState });
      }
    }

    try {
      if ('getReader' in eventSource) {
        // ReadableStream path
        const reader = eventSource.getReader();
        const onAbort = () => {
          // Cancel the underlying stream so pending reads resolve promptly.
          void reader.cancel().catch(() => {
            // Ignore cancellation failures from already-closed streams.
          });
        };

        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        try {
          while (true) {
            if (signal.aborted) break;
            const { done, value } = await reader.read();
            if (done || signal.aborted) break;
            await runMiddleware(value);
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
          reader.releaseLock();
        }
      } else {
        // AsyncIterable path
        for await (const event of eventSource) {
          if (signal.aborted) break;
          await runMiddleware(event);
        }
      }

      if (signal.aborted) {
        dispatch({ type: 'stream/abort' });
        for (const mw of middlewares) {
          if (isMiddlewareObject(mw) && mw.onAbort) {
            await mw.onAbort({ state: fullState });
          }
        }
      } else if (rawState.status === 'streaming') {
        // Stream ended naturally without a finish event — dispatch complete
        dispatch({ type: 'stream/complete' });
        for (const mw of middlewares) {
          if (isMiddlewareObject(mw) && mw.onComplete) {
            await mw.onComplete({ state: fullState });
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: 'stream/error', error });
      for (const mw of middlewares) {
        if (isMiddlewareObject(mw) && mw.onError) {
          await mw.onError(error, { state: fullState });
        }
      }
    }
  }

  function submit(input: SubmitInput): StreamHandle {
    // Abort previous stream if active
    if (activeAbort) {
      activeAbort.abort();
    }
    externalSignalCleanup?.();
    externalSignalCleanup = null;

    const controller = new AbortController();
    activeAbort = controller;
    lastInput = input;

    // Compose with external signal
    if (input.signal) {
      if (input.signal.aborted) {
        controller.abort();
      } else {
        const onExternalAbort = () => controller.abort();
        input.signal.addEventListener('abort', onExternalAbort, { once: true });
        externalSignalCleanup = () => input.signal!.removeEventListener('abort', onExternalAbort);
      }
    }

    // Append user message if provided as shorthand
    if (input.message) {
      dispatch({
        type: 'messages/append',
        message: {
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: input.message }],
          createdAt: new Date(),
        },
      });
    } else if (input.messages) {
      for (const msg of input.messages) {
        dispatch({ type: 'messages/append', message: msg });
      }
    }

    dispatch({
      type: 'stream/start',
      meta: {
        model: options?.provider?.name,
        provider: options?.provider?.name,
      },
    });

    // Determine event source
    if (input.response) {
      // Complete (non-streaming) response — convert to events
      consumeStream(responseToEvents(input.response), controller.signal);
    } else if (input.events) {
      // Direct events — skip parsing
      consumeStream(input.events, controller.signal);
    } else if (input.stream) {
      // Raw byte stream — parse SSE and run through provider
      const provider = options?.provider;
      let eventStream: ReadableStream<StreamEvent>;

      if (provider) {
        eventStream = input.stream
          .pipeThrough(createSSEParser())
          .pipeThrough(provider.createTransform());
      } else {
        // No provider — treat as raw text stream
        eventStream = input.stream
          .pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
          .pipeThrough(
            new TransformStream<string, StreamEvent>({
              transform(chunk, ctrl) {
                ctrl.enqueue({ type: 'text-delta', text: chunk });
              },
            }),
          );
      }

      consumeStream(eventStream, controller.signal);
    }

    return {
      abort: () => controller.abort(),
      signal: controller.signal,
    };
  }

  const store: AIStore<T> = {
    get(key?: keyof AIFullState<T>) {
      if (key !== undefined) return fullState[key];
      return fullState;
    },

    subscribe(keyOrListener: any, listener?: any) {
      if (typeof keyOrListener === 'function') {
        // Full state listener
        listeners.add(keyOrListener);
        return () => {
          listeners.delete(keyOrListener);
        };
      }

      // Key-specific listener
      const key = keyOrListener as keyof AIFullState<T>;
      if (!keyListeners.has(key)) {
        keyListeners.set(key, new Set());
      }
      keyListeners.get(key)!.add(listener);
      return () => {
        keyListeners.get(key)?.delete(listener);
      };
    },

    submit,

    abort() {
      if (activeAbort) {
        activeAbort.abort();
        activeAbort = null;
      }
    },

    reset() {
      if (activeAbort) {
        activeAbort.abort();
        activeAbort = null;
      }
      externalSignalCleanup?.();
      externalSignalCleanup = null;
      lastInput = null;
      dispatch({ type: 'reset' });
    },

    setMessages(messages: Message[]) {
      if (!Array.isArray(messages)) {
        throw new TypeError('setMessages() expects an array of Message objects');
      }
      dispatch({ type: 'messages/set', messages });
    },

    addToolResult(toolCallId: string, result: unknown) {
      if (typeof toolCallId !== 'string' || toolCallId === '') {
        throw new TypeError('addToolResult() expects a non-empty toolCallId string');
      }
      dispatch({ type: 'tool/result', toolCallId, result });
    },

    retry() {
      if (!lastInput) {
        throw new Error('No previous submission to retry');
      }
      return submit(lastInput);
    },

    use(middleware: Middleware) {
      middlewares.push(middleware);
      return () => {
        const idx = middlewares.indexOf(middleware);
        if (idx !== -1) middlewares.splice(idx, 1);
      };
    },

    destroy() {
      if (activeAbort) {
        activeAbort.abort();
        activeAbort = null;
      }
      externalSignalCleanup?.();
      externalSignalCleanup = null;
      lastInput = null;
      listeners.clear();
      keyListeners.clear();
      middlewares.length = 0;
    },
  } as AIStore<T>;

  return store;
}
