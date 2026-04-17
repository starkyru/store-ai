import type { FinishReason, ProviderAdapter, SSEEvent, StreamEvent } from '../types.js';

/**
 * Provider adapter for the Vercel AI SDK Data Stream protocol.
 *
 * The AI SDK UI uses a "Message Stream" format where each SSE data field
 * contains a typed JSON object. Key event types:
 *
 * - text-delta         — streamed text chunk { textDelta: "..." }
 * - reasoning          — reasoning/thinking chunk { textDelta: "..." }
 * - tool-call-start    — tool call begins { toolCallId, toolName }
 * - tool-call-delta    — tool call args chunk { toolCallId, argsTextDelta }
 * - tool-call          — tool call complete { toolCallId, toolName, args }
 * - tool-result        — tool result (ignored — handled by consumer)
 * - step-finish        — step boundary with optional usage
 * - finish             — stream complete with optional usage
 * - error              — error { errorMessage: "..." }
 */
export function aiSdkDataStream(): ProviderAdapter {
  return {
    name: 'ai-sdk-data-stream',
    createTransform() {
      let stepCounter = 0;

      return new TransformStream<SSEEvent, StreamEvent>({
        transform(sse, controller) {
          let data: any;
          try {
            data = JSON.parse(sse.data);
          } catch {
            controller.enqueue({
              type: 'error',
              error: new Error(`Failed to parse AI SDK data stream (${sse.data.length} bytes)`),
            });
            return;
          }

          switch (data.type) {
            case 'text-delta': {
              if (data.textDelta) {
                controller.enqueue({ type: 'text-delta', text: data.textDelta });
              }
              break;
            }

            case 'reasoning':
            case 'reasoning-delta': {
              if (data.textDelta) {
                controller.enqueue({ type: 'thinking-delta', text: data.textDelta });
              }
              break;
            }

            case 'tool-call-start': {
              controller.enqueue({
                type: 'tool-call-start',
                id: data.toolCallId ?? '',
                name: data.toolName ?? '',
              });
              break;
            }

            case 'tool-call-delta': {
              if (data.toolCallId && data.argsTextDelta) {
                controller.enqueue({
                  type: 'tool-call-delta',
                  id: data.toolCallId,
                  inputDelta: data.argsTextDelta,
                });
              }
              break;
            }

            case 'tool-call': {
              controller.enqueue({
                type: 'tool-call-end',
                id: data.toolCallId ?? '',
                input: data.args ?? undefined,
              });
              break;
            }

            case 'tool-result': {
              // Tool results are handled by the consumer, not the provider
              break;
            }

            case 'step-finish': {
              if (data.usage) {
                controller.enqueue({
                  type: 'usage',
                  usage: {
                    inputTokens: data.usage.promptTokens ?? 0,
                    outputTokens: data.usage.completionTokens ?? 0,
                  },
                });
              }
              const stepId = `step_${stepCounter++}`;
              controller.enqueue({ type: 'step-end', stepId });
              break;
            }

            case 'finish': {
              if (data.usage) {
                controller.enqueue({
                  type: 'usage',
                  usage: {
                    inputTokens: data.usage.promptTokens ?? 0,
                    outputTokens: data.usage.completionTokens ?? 0,
                  },
                });
              }
              const reason = mapFinishReason(data.finishReason);
              controller.enqueue({ type: 'finish', reason });
              break;
            }

            case 'error': {
              controller.enqueue({
                type: 'error',
                error: new Error(data.errorMessage ?? 'AI SDK stream error'),
              });
              break;
            }

            // Unknown types are silently ignored
          }
        },
      });
    },
  };
}

function mapFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool-calls':
      return 'tool-calls';
    case 'length':
      return 'length';
    case 'error':
      return 'error';
    default:
      return 'stop';
  }
}
