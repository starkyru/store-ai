import type { StreamEvent } from '../types.js';

/** Messages sent from main thread to worker */
export type WorkerRequest =
  | { type: 'start'; streamId: string; provider: string; chunks: never }
  | { type: 'chunk'; streamId: string; chunk: Uint8Array }
  | { type: 'end'; streamId: string }
  | { type: 'abort'; streamId: string };

/** Messages sent from worker to main thread */
export type WorkerResponse =
  | { type: 'event'; streamId: string; event: StreamEvent }
  | { type: 'error'; streamId: string; message: string }
  | { type: 'done'; streamId: string };
