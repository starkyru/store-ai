import type { SSEEvent, StreamEvent } from '../types.js';
import type { WorkerRequest, WorkerResponse } from './types.js';
import { createSSEParser } from '../parsers/sse.js';
import { anthropic } from '../providers/anthropic.js';
import { openai } from '../providers/openai.js';
import { openaiResponses } from '../providers/openai-responses.js';
import { aiSdkDataStream } from '../providers/ai-sdk-data-stream.js';

type ProviderFactory = () => { createTransform(): TransformStream<SSEEvent, StreamEvent> };

const PROVIDERS: Record<string, ProviderFactory> = {
  anthropic,
  openai,
  'openai-responses': openaiResponses,
  'ai-sdk-data-stream': aiSdkDataStream,
};

interface ActiveStream {
  sseWriter: WritableStreamDefaultWriter<Uint8Array>;
  aborted: boolean;
}

function post(msg: WorkerResponse): void {
  (globalThis as unknown as { postMessage(msg: unknown): void }).postMessage(msg);
}

/**
 * Sets up message handling inside a Web Worker.
 * Call this in your worker file:
 *
 * ```ts
 * // ai-worker.ts
 * import { setupWorkerHandler } from '@store-ai/core';
 * setupWorkerHandler();
 * ```
 *
 * The handler listens for messages from the main thread,
 * creates SSE parser + provider transform pipelines,
 * and posts parsed StreamEvent objects back.
 *
 * Note: This function should only be called inside a Web Worker context.
 * It uses worker globals (self.addEventListener / self.postMessage).
 */
export function setupWorkerHandler(): void {
  const activeStreams = new Map<string, ActiveStream>();

  (
    globalThis as unknown as {
      addEventListener(type: string, handler: (e: MessageEvent) => void): void;
    }
  ).addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
    const msg = e.data;

    switch (msg.type) {
      case 'start': {
        const providerFactory = PROVIDERS[msg.provider];
        if (!providerFactory) {
          post({
            type: 'error',
            streamId: msg.streamId,
            message: `Unknown provider: ${msg.provider}`,
          });
          return;
        }

        // Build the pipeline: raw bytes -> SSE parser -> provider transform -> StreamEvent
        const sseParser = createSSEParser();
        const providerTransform = providerFactory().createTransform();

        const sseReadable = sseParser.readable;
        const sseWriter = sseParser.writable.getWriter();

        // Pipe SSE events through the provider transform and post results back
        const streamId = msg.streamId;
        sseReadable
          .pipeThrough(providerTransform)
          .pipeTo(
            new WritableStream<StreamEvent>({
              write(event) {
                post({ type: 'event', streamId, event });
              },
              close() {
                post({ type: 'done', streamId });
                activeStreams.delete(streamId);
              },
              abort(reason) {
                const message =
                  reason instanceof Error ? reason.message : String(reason ?? 'Stream aborted');
                post({ type: 'error', streamId, message });
                activeStreams.delete(streamId);
              },
            }),
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            post({ type: 'error', streamId, message });
            activeStreams.delete(streamId);
          });

        activeStreams.set(msg.streamId, { sseWriter, aborted: false });
        break;
      }

      case 'chunk': {
        const active = activeStreams.get(msg.streamId);
        if (active && !active.aborted) {
          active.sseWriter.write(msg.chunk).catch(() => {
            // Writer closed or errored — ignore
          });
        }
        break;
      }

      case 'end': {
        const active = activeStreams.get(msg.streamId);
        if (active && !active.aborted) {
          active.sseWriter.close().catch(() => {
            // Writer already closed — ignore
          });
        }
        break;
      }

      case 'abort': {
        const active = activeStreams.get(msg.streamId);
        if (active) {
          active.aborted = true;
          active.sseWriter.abort().catch(() => {
            // Writer already closed — ignore
          });
          activeStreams.delete(msg.streamId);
          post({ type: 'done', streamId: msg.streamId });
        }
        break;
      }
    }
  });
}
