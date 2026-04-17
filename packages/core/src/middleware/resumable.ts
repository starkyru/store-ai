import type { MiddlewareContext, MiddlewareObject, StorageAdapter, StreamEvent } from '../types.js';
import { STREAM_EVENT_TYPES } from '../types.js';

export interface ResumableOptions {
  /** Storage adapter for persisting stream state */
  storage: StorageAdapter;
  /** Unique stream ID (typically chatId + requestId) */
  streamId: string;
}

export interface StreamCheckpoint {
  streamId: string;
  /** Events received so far, in order */
  events: StreamEvent[];
  /** Whether the stream completed */
  completed: boolean;
  /** Timestamp of last event */
  lastEventAt: string;
}

const STORAGE_PREFIX = 'stream:';
const FLUSH_INTERVAL = 10;
const MAX_BUFFERED_EVENTS = 5000;
const VALID_STREAM_ID = /^[\w.:-]+$/;

function isStreamEvent(value: unknown): value is StreamEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = (value as Record<string, unknown>)['type'];
  return typeof type === 'string' && STREAM_EVENT_TYPES.has(type);
}

function isStreamCheckpoint(value: unknown): value is StreamCheckpoint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['streamId'] === 'string' &&
    Array.isArray(obj['events']) &&
    obj['events'].every(isStreamEvent) &&
    typeof obj['completed'] === 'boolean' &&
    typeof obj['lastEventAt'] === 'string'
  );
}

async function flush(
  storage: StorageAdapter,
  streamId: string,
  events: StreamEvent[],
  completed: boolean,
): Promise<void> {
  try {
    const checkpoint: StreamCheckpoint = {
      streamId,
      events: [...events],
      completed,
      lastEventAt: new Date().toISOString(),
    };
    await storage.set(`${STORAGE_PREFIX}${streamId}`, checkpoint);
  } catch {
    // Storage failures are non-fatal — never crash the stream
  }
}

/**
 * Resume a previously interrupted stream by replaying stored events.
 * Returns the checkpoint if found, or null.
 *
 * Usage:
 * ```ts
 * const checkpoint = await getStreamCheckpoint(storage, streamId);
 * if (checkpoint && !checkpoint.completed) {
 *   // Replay events into a new store
 *   for (const event of checkpoint.events) {
 *     // Feed to store via events
 *   }
 *   // Then reconnect for remaining events
 * }
 * ```
 */
export async function getStreamCheckpoint(
  storage: StorageAdapter,
  streamId: string,
): Promise<StreamCheckpoint | null> {
  try {
    const data = await storage.get(`${STORAGE_PREFIX}${streamId}`);
    return isStreamCheckpoint(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Delete a previously saved stream checkpoint from storage.
 */
export async function deleteStreamCheckpoint(
  storage: StorageAdapter,
  streamId: string,
): Promise<void> {
  try {
    await storage.delete(`${STORAGE_PREFIX}${streamId}`);
  } catch {
    // Silently ignore
  }
}

/**
 * Middleware that checkpoints stream events to storage, enabling resumption
 * after connection drops. Events are buffered in memory and periodically
 * flushed (every {@link FLUSH_INTERVAL} events, plus on complete/error/abort).
 *
 * @example
 * ```ts
 * const store = createAIStore({
 *   middleware: [resumable({ storage, streamId: 'chat-1:req-42' })],
 * });
 * ```
 */
export function resumable(opts: ResumableOptions): MiddlewareObject {
  if (!VALID_STREAM_ID.test(opts.streamId)) {
    throw new Error(
      `Invalid streamId "${opts.streamId}": must match ${VALID_STREAM_ID} (alphanumeric, dots, colons, hyphens, underscores)`,
    );
  }

  const events: StreamEvent[] = [];
  let eventCount = 0;

  return {
    name: 'resumable',

    onStart() {
      events.length = 0;
      eventCount = 0;
    },

    async onEvent(ctx: MiddlewareContext, next: () => Promise<void>) {
      events.push(ctx.event);
      eventCount++;

      // Prevent unbounded memory growth on long-running streams
      if (events.length > MAX_BUFFERED_EVENTS) {
        events.splice(0, events.length - MAX_BUFFERED_EVENTS);
      }

      await next();

      // Flush on finish event (after next() so the reducer has processed it).
      // The store's onComplete hook won't fire when a finish event already
      // moved the status to 'complete', so we handle it here.
      if (ctx.event.type === 'finish') {
        await flush(opts.storage, opts.streamId, events, true);
        return;
      }

      // Periodic flush for long-running streams
      if (eventCount % FLUSH_INTERVAL === 0) {
        await flush(opts.storage, opts.streamId, events, false);
      }
    },

    async onComplete() {
      // Handles streams that end naturally without a finish event
      await flush(opts.storage, opts.streamId, events, true);
    },

    async onError() {
      await flush(opts.storage, opts.streamId, events, false);
    },

    async onAbort() {
      await flush(opts.storage, opts.streamId, events, false);
    },
  };
}
