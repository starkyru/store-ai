import type { ProviderAdapter, SSEEvent, StreamEvent } from '../types.js';

/**
 * Provider adapter for OpenAI's Responses API streaming.
 *
 * Unlike Chat Completions (data-only SSE), the Responses API uses semantic
 * SSE event names via the `event:` field:
 *
 * - response.created           — response object with model info
 * - response.in_progress       — response is being generated
 * - response.output_text.delta — text token { delta: "..." }
 * - response.output_text.done  — text complete { text: "..." }
 * - response.function_call_arguments.delta — tool call arg chunk
 * - response.function_call_arguments.done  — tool call args complete
 * - response.reasoning_text.delta — reasoning token { delta: "..." }
 * - response.reasoning_text.done  — reasoning complete
 * - response.refusal.delta     — refusal text
 * - response.completed         — response done, includes usage
 * - response.failed            — error
 * - response.cancelled         — cancelled
 */
export function openaiResponses(): ProviderAdapter {
  return {
    name: 'openai-responses',
    createTransform() {
      // Track active tool calls: item_id → { callId, name }
      const activeToolCalls = new Map<string, { callId: string; name: string }>();

      return new TransformStream<SSEEvent, StreamEvent>({
        transform(sse, controller) {
          const eventType = sse.event;

          let data: any;
          try {
            data = JSON.parse(sse.data);
          } catch {
            controller.enqueue({
              type: 'error',
              error: new Error(
                `Failed to parse OpenAI Responses SSE data (${sse.data.length} chars)`,
              ),
            });
            return;
          }

          switch (eventType) {
            case 'response.created': {
              if (data.model) {
                controller.enqueue({ type: 'metadata', key: 'model', value: data.model });
              }
              break;
            }

            case 'response.in_progress': {
              // Informational — no action needed
              break;
            }

            case 'response.output_text.delta': {
              if (data.delta) {
                controller.enqueue({ type: 'text-delta', text: data.delta });
              }
              break;
            }

            case 'response.output_text.done': {
              // Text complete — no additional action needed (deltas already emitted)
              break;
            }

            case 'response.reasoning_text.delta': {
              if (data.delta) {
                controller.enqueue({ type: 'thinking-delta', text: data.delta });
              }
              break;
            }

            case 'response.reasoning_text.done': {
              // Reasoning complete — no additional action needed
              break;
            }

            case 'response.function_call_arguments.delta': {
              const itemId = data.item_id;
              const callId = data.call_id;

              if (itemId && callId && !activeToolCalls.has(itemId)) {
                // First delta for this tool call — emit start
                activeToolCalls.set(itemId, { callId, name: '' });
                controller.enqueue({
                  type: 'tool-call-start',
                  id: callId,
                  name: data.name ?? '',
                });
              }

              if (data.delta && callId) {
                controller.enqueue({
                  type: 'tool-call-delta',
                  id: callId,
                  inputDelta: data.delta,
                });
              }
              break;
            }

            case 'response.function_call_arguments.done': {
              const itemId = data.item_id;
              const callId = data.call_id;

              if (itemId && callId && !activeToolCalls.has(itemId)) {
                // Got done without any deltas — emit start first
                activeToolCalls.set(itemId, { callId, name: data.name ?? '' });
                controller.enqueue({
                  type: 'tool-call-start',
                  id: callId,
                  name: data.name ?? '',
                });
              }

              if (callId) {
                controller.enqueue({
                  type: 'tool-call-end',
                  id: callId,
                  input: undefined,
                });
              }

              if (itemId) {
                activeToolCalls.delete(itemId);
              }
              break;
            }

            case 'response.refusal.delta': {
              // Refusals are surfaced as text deltas so they appear in the UI
              if (data.delta) {
                controller.enqueue({ type: 'text-delta', text: data.delta });
              }
              break;
            }

            case 'response.completed': {
              if (data.response?.usage) {
                const usage = data.response.usage;
                controller.enqueue({
                  type: 'usage',
                  usage: {
                    inputTokens: usage.input_tokens ?? 0,
                    outputTokens: usage.output_tokens ?? 0,
                    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
                  },
                });
              }
              controller.enqueue({ type: 'finish', reason: 'stop' });
              break;
            }

            case 'response.failed': {
              const message =
                data.response?.error?.message ??
                data.error?.message ??
                'OpenAI Responses API error';
              controller.enqueue({
                type: 'error',
                error: new Error(message),
              });
              break;
            }

            case 'response.cancelled': {
              controller.enqueue({ type: 'finish', reason: 'stop' });
              break;
            }

            // Ignore other event types (e.g. response.output_item.added, etc.)
          }
        },
      });
    },
  };
}
