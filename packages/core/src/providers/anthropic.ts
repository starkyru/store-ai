import type { ProviderAdapter, SSEEvent, StreamEvent } from '../types.js';

/**
 * Provider adapter for Anthropic's streaming API.
 *
 * Handles SSE events:
 * - message_start: extract model, usage
 * - content_block_start: detect text vs tool_use vs thinking blocks
 * - content_block_delta: text_delta, input_json_delta, thinking_delta
 * - content_block_stop: finalize blocks
 * - message_delta: end_turn reason, final usage
 * - message_stop: stream complete
 * - ping: ignored
 * - error: API errors
 */
export function anthropic(): ProviderAdapter {
  return {
    name: 'anthropic',
    createTransform() {
      let currentBlockType: string | null = null;
      let currentToolCallId: string | null = null;

      return new TransformStream<SSEEvent, StreamEvent>({
        transform(sse, controller) {
          // Skip ping events
          if (sse.event === 'ping') return;

          let data: any;
          try {
            data = JSON.parse(sse.data);
          } catch {
            controller.enqueue({
              type: 'error',
              error: new Error(
                `Failed to parse Anthropic SSE data (${sse.data.length} chars, starts: ${sse.data.slice(0, 80)}...)`,
              ),
            });
            return;
          }

          switch (sse.event ?? data.type) {
            case 'message_start': {
              const msg = data.message;
              if (msg?.model) {
                controller.enqueue({ type: 'metadata', key: 'model', value: msg.model });
              }
              if (msg?.usage) {
                controller.enqueue({
                  type: 'usage',
                  usage: {
                    inputTokens: msg.usage.input_tokens ?? 0,
                    outputTokens: msg.usage.output_tokens ?? 0,
                    reasoningTokens: 0,
                  },
                });
              }
              break;
            }

            case 'content_block_start': {
              const block = data.content_block;
              currentBlockType = block?.type ?? null;

              if (block?.type === 'tool_use') {
                currentToolCallId = block.id;
                controller.enqueue({
                  type: 'tool-call-start',
                  id: block.id,
                  name: block.name,
                });
              }
              break;
            }

            case 'content_block_delta': {
              const delta = data.delta;
              if (!delta) break;

              switch (delta.type) {
                case 'text_delta':
                  controller.enqueue({ type: 'text-delta', text: delta.text });
                  break;

                case 'input_json_delta':
                  if (currentToolCallId) {
                    controller.enqueue({
                      type: 'tool-call-delta',
                      id: currentToolCallId,
                      inputDelta: delta.partial_json,
                    });
                  }
                  break;

                case 'thinking_delta':
                  controller.enqueue({ type: 'thinking-delta', text: delta.thinking });
                  break;

                // signature_delta — skip (internal verification)
              }
              break;
            }

            case 'content_block_stop': {
              if (currentBlockType === 'tool_use' && currentToolCallId) {
                // Tool call block ended — try to parse accumulated input
                // The complete input will be assembled by the store from deltas
                controller.enqueue({
                  type: 'tool-call-end',
                  id: currentToolCallId,
                  input: undefined, // Store assembles from inputText
                });
              }
              currentBlockType = null;
              currentToolCallId = null;
              break;
            }

            case 'message_delta': {
              const delta = data.delta;
              if (data.usage) {
                controller.enqueue({
                  type: 'usage',
                  usage: {
                    outputTokens: data.usage.output_tokens ?? 0,
                  },
                });
              }
              if (delta?.stop_reason) {
                const reason =
                  delta.stop_reason === 'end_turn'
                    ? 'stop'
                    : delta.stop_reason === 'tool_use'
                      ? 'tool-calls'
                      : delta.stop_reason === 'max_tokens'
                        ? 'length'
                        : 'stop';
                controller.enqueue({ type: 'finish', reason });
              }
              break;
            }

            case 'message_stop': {
              // Final signal — if no finish was sent via message_delta
              break;
            }

            case 'error': {
              controller.enqueue({
                type: 'error',
                error: new Error(data.error?.message ?? 'Anthropic API error'),
              });
              break;
            }
          }
        },
      });
    },
  };
}
