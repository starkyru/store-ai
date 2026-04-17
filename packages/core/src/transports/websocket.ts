import type { AIStore } from '../store.js';
import type { StreamEvent, StreamHandle } from '../types.js';

export interface WebSocketTransportOptions {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Protocols for the WebSocket constructor */
  protocols?: string | string[];
  /** Format of incoming messages: 'json' (each message is a StreamEvent JSON object) or 'text' (each message is raw text, emitted as text-delta) */
  format?: 'json' | 'text';
  /** Called when the connection opens. Use to send initial handshake/prompt. */
  onOpen?: (ws: WebSocket) => void;
  /** Transform raw message data before processing. Return null to skip. */
  transformMessage?: (data: unknown) => StreamEvent | null;
}

interface QueueItem {
  value: StreamEvent;
  done: false;
}

interface QueueEnd {
  value: undefined;
  done: true;
}

type QueueEntry = QueueItem | QueueEnd;

/**
 * Creates an AsyncIterable<StreamEvent> from a WebSocket connection.
 * Use with store.submit({ events: createWebSocketTransport(opts) }).
 *
 * The connection is automatically closed when the returned iterator is
 * done or when the AbortSignal (from store.abort()) fires.
 */
export function createWebSocketTransport(
  options: WebSocketTransportOptions,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const { url, protocols, format = 'json', onOpen, transformMessage } = options;

  const queue: QueueEntry[] = [];
  let resolve: ((entry: QueueEntry) => void) | null = null;
  let done = false;

  function enqueue(entry: QueueEntry): void {
    if (done && entry.done === false) return;
    if (resolve) {
      const r = resolve;
      resolve = null;
      r(entry);
    } else {
      queue.push(entry);
    }
  }

  function enqueueEvent(event: StreamEvent): void {
    enqueue({ value: event, done: false });
  }

  function end(): void {
    if (done) return;
    done = true;
    enqueue({ value: undefined, done: true });
  }

  const ws = new WebSocket(url, protocols);

  ws.onopen = () => {
    onOpen?.(ws);
  };

  ws.onmessage = (event: MessageEvent) => {
    if (done) return;

    const raw = event.data;

    if (transformMessage) {
      const result = transformMessage(raw);
      if (result !== null) {
        enqueueEvent(result);
      }
      return;
    }

    if (format === 'text') {
      enqueueEvent({ type: 'text-delta', text: String(raw) });
      return;
    }

    // format === 'json'
    try {
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'type' in (parsed as Record<string, unknown>)
      ) {
        enqueueEvent(parsed as StreamEvent);
      }
    } catch {
      // Malformed JSON -- skip
    }
  };

  ws.onerror = () => {
    if (done) return;
    enqueueEvent({ type: 'error', error: new Error('WebSocket error') });
    end();
  };

  ws.onclose = () => {
    end();
  };

  if (signal) {
    const onAbort = () => {
      if (done) return;
      enqueueEvent({ type: 'finish', reason: 'stop' });
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const iterable: AsyncIterable<StreamEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<StreamEvent>> {
          const queued = queue.shift();
          if (queued) {
            if (queued.done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return Promise.resolve({ value: queued.value, done: false });
          }

          if (done) {
            return Promise.resolve({ value: undefined, done: true });
          }

          return new Promise<IteratorResult<StreamEvent>>((r) => {
            resolve = (entry) => {
              if (entry.done) {
                r({ value: undefined, done: true });
              } else {
                r({ value: entry.value, done: false });
              }
            };
          });
        },

        return(): Promise<IteratorResult<StreamEvent>> {
          done = true;
          if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return iterable;
}

/**
 * Submit a prompt via WebSocket. Opens connection, sends prompt, streams response.
 */
export function submitViaWebSocket(
  store: AIStore,
  options: WebSocketTransportOptions & { message?: string },
): StreamHandle {
  const { message, onOpen, ...rest } = options;

  // Create a shared controller so that store.abort() propagates to the
  // WebSocket transport, allowing the blocked async iterator to resolve.
  const controller = new AbortController();

  const events = createWebSocketTransport(
    {
      ...rest,
      onOpen: (ws) => {
        if (message) {
          ws.send(message);
        }
        onOpen?.(ws);
      },
    },
    controller.signal,
  );

  const handle = store.submit({ events, message });

  // When the store aborts (via handle.abort() or store.abort()),
  // also abort the transport's controller so the WebSocket closes.
  handle.signal.addEventListener('abort', () => controller.abort(), { once: true });

  return handle;
}
