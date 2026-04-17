import type { StreamEvent } from '../types.js';
import type { WorkerRequest, WorkerResponse } from './types.js';

export interface WorkerStreamOptions {
  /** The Web Worker instance to offload parsing to */
  worker: Worker;
  /** The raw byte stream from fetch */
  stream: ReadableStream<Uint8Array>;
  /** Unique ID for this stream (for multiplexing) */
  streamId?: string;
  /** Provider name to use in the worker ('anthropic', 'openai', 'openai-responses', 'ai-sdk-data-stream') */
  provider: string;
  /** Abort signal */
  signal?: AbortSignal;
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
 * Offloads stream parsing to a Web Worker.
 * Returns an AsyncIterable<StreamEvent> that yields events parsed in the worker.
 *
 * Usage:
 * ```ts
 * const events = createWorkerStream({
 *   worker: new Worker(new URL('./ai-worker.js', import.meta.url)),
 *   stream: response.body!,
 *   provider: 'anthropic',
 * });
 * store.submit({ events });
 * ```
 */
export function createWorkerStream(options: WorkerStreamOptions): AsyncIterable<StreamEvent> {
  const { worker, stream, provider, signal } = options;
  const streamId = options.streamId ?? crypto.randomUUID();

  const queue: QueueEntry[] = [];
  let resolve: ((entry: QueueEntry) => void) | null = null;
  let done = false;

  function enqueue(entry: QueueEntry): void {
    if (done && !entry.done) return;
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

  function post(msg: WorkerRequest, transfer?: Transferable[]): void {
    if (done) return;
    worker.postMessage(msg, transfer ?? []);
  }

  // Listen for messages from the worker
  function onMessage(e: MessageEvent<WorkerResponse>): void {
    const msg = e.data;
    if (msg.streamId !== streamId) return;

    switch (msg.type) {
      case 'event':
        enqueueEvent(msg.event);
        break;
      case 'error':
        enqueueEvent({ type: 'error', error: new Error(msg.message) });
        end();
        break;
      case 'done':
        end();
        break;
    }
  }

  worker.addEventListener('message', onMessage);

  // Handle abort
  function onAbort(): void {
    post({ type: 'abort', streamId } as WorkerRequest);
    end();
  }

  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  // Send start message
  post({ type: 'start', streamId, provider } as WorkerRequest);

  // Read chunks from the stream and forward to the worker
  async function pumpStream(): Promise<void> {
    try {
      const reader = stream.getReader();
      try {
        while (true) {
          if (done) break;
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          if (value) {
            // Transfer the buffer for zero-copy
            post({ type: 'chunk', streamId, chunk: value } as WorkerRequest, [value.buffer]);
          }
        }
      } finally {
        reader.releaseLock();
      }
      post({ type: 'end', streamId } as WorkerRequest);
    } catch (err) {
      if (!done) {
        enqueueEvent({
          type: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
        end();
      }
    }
  }

  // Start pumping (fire-and-forget)
  pumpStream();

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
          worker.removeEventListener('message', onMessage);
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return iterable;
}
