import type { ProviderAdapter, SSEEvent, StreamEvent } from '../types.js';

/**
 * Provider adapter for the AG-UI protocol.
 *
 * AG-UI defines 16 event types for agent-to-frontend communication
 * via SSE with typed JSON payloads. Each event has a `type` field
 * in the JSON body. Key mappings:
 *
 * - TEXT_MESSAGE_CONTENT  -> text-delta
 * - TOOL_CALL_START       -> tool-call-start
 * - TOOL_CALL_END         -> tool-call-end
 * - RUN_STARTED           -> step-start
 * - RUN_FINISHED          -> finish(stop)
 * - RUN_ERROR             -> error
 * - STEP_STARTED          -> step-start
 * - STEP_FINISHED         -> step-end
 * - STATE_DELTA / STATE_SNAPSHOT / MESSAGES_SNAPSHOT / CUSTOM / RAW -> metadata
 * - TEXT_MESSAGE_START / TEXT_MESSAGE_END -> structural, no output
 */
export function agUI(): ProviderAdapter {
  return {
    name: 'ag-ui',
    createTransform() {
      return new TransformStream<SSEEvent, StreamEvent>({
        transform(sse, controller) {
          let data: any;
          try {
            data = JSON.parse(sse.data);
          } catch {
            controller.enqueue({
              type: 'error',
              error: new Error(`Failed to parse AG-UI event (${sse.data.length} bytes)`),
            });
            return;
          }

          const eventType = data.type ?? sse.event;

          switch (eventType) {
            case 'TEXT_MESSAGE_CONTENT':
              if (data.delta) controller.enqueue({ type: 'text-delta', text: data.delta });
              break;

            case 'TOOL_CALL_START':
              controller.enqueue({
                type: 'tool-call-start',
                id: data.toolCallId ?? data.id ?? '',
                name: data.toolCallName ?? data.name ?? '',
              });
              break;

            case 'TOOL_CALL_END':
              controller.enqueue({
                type: 'tool-call-end',
                id: data.toolCallId ?? data.id ?? '',
                input: data.toolCallArgs ?? data.args ?? data.result,
              });
              break;

            case 'RUN_STARTED':
              controller.enqueue({ type: 'step-start', stepId: data.runId ?? 'run' });
              break;

            case 'RUN_FINISHED':
              controller.enqueue({ type: 'finish', reason: 'stop' });
              break;

            case 'RUN_ERROR':
              controller.enqueue({
                type: 'error',
                error: new Error(data.message ?? data.error ?? 'AG-UI run error'),
              });
              break;

            case 'STEP_STARTED':
              controller.enqueue({ type: 'step-start', stepId: data.stepId ?? '' });
              break;

            case 'STEP_FINISHED':
              controller.enqueue({ type: 'step-end', stepId: data.stepId ?? '' });
              break;

            case 'STATE_DELTA':
            case 'STATE_SNAPSHOT':
            case 'MESSAGES_SNAPSHOT':
            case 'CUSTOM':
            case 'RAW':
              controller.enqueue({ type: 'metadata', key: eventType.toLowerCase(), value: data });
              break;

            // TEXT_MESSAGE_START, TEXT_MESSAGE_END -- structural, no content
            default:
              break;
          }
        },
      });
    },
  };
}
