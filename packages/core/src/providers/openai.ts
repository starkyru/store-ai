import type { ProviderAdapter, SSEEvent, StreamEvent } from '../types.js';

/**
 * Provider adapter for OpenAI's Chat Completions streaming API.
 *
 * Handles data-only SSE (no event: field):
 * - choices[0].delta.content — text tokens
 * - choices[0].delta.tool_calls — incremental tool call arguments
 * - choices[0].delta.reasoning_content — reasoning tokens (o-series models)
 * - choices[0].finish_reason — stream end
 * - usage — token counts (final chunk only)
 */
export function openai(): ProviderAdapter {
  return {
    name: 'openai',
    createTransform() {
      const activeToolCalls = new Map<number, string>(); // index → id

      return new TransformStream<SSEEvent, StreamEvent>({
        transform(sse, controller) {
          let data: any;
          try {
            data = JSON.parse(sse.data);
          } catch {
            controller.enqueue({
              type: 'error',
              error: new Error(
                `Failed to parse OpenAI SSE data (${sse.data.length} chars, starts: ${sse.data.slice(0, 80)}...)`,
              ),
            });
            return;
          }

          // Model metadata
          if (data.model) {
            controller.enqueue({ type: 'metadata', key: 'model', value: data.model });
          }

          const choice = data.choices?.[0];
          if (choice) {
            const delta = choice.delta;

            if (delta) {
              // Text content
              if (delta.content) {
                controller.enqueue({ type: 'text-delta', text: delta.content });
              }

              // Reasoning content (o-series models)
              if (delta.reasoning_content) {
                controller.enqueue({ type: 'thinking-delta', text: delta.reasoning_content });
              }

              // Tool calls
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;

                  if (tc.id) {
                    // New tool call
                    activeToolCalls.set(index, tc.id);
                    controller.enqueue({
                      type: 'tool-call-start',
                      id: tc.id,
                      name: tc.function?.name ?? '',
                    });
                  }

                  if (tc.function?.arguments) {
                    const id = activeToolCalls.get(index);
                    if (id) {
                      controller.enqueue({
                        type: 'tool-call-delta',
                        id,
                        inputDelta: tc.function.arguments,
                      });
                    }
                  }
                }
              }
            }

            // Finish reason
            if (choice.finish_reason) {
              // Complete any active tool calls
              for (const [_index, id] of activeToolCalls) {
                controller.enqueue({
                  type: 'tool-call-end',
                  id,
                  input: undefined,
                });
              }
              activeToolCalls.clear();

              const reason =
                choice.finish_reason === 'stop'
                  ? 'stop'
                  : choice.finish_reason === 'tool_calls'
                    ? 'tool-calls'
                    : choice.finish_reason === 'length'
                      ? 'length'
                      : 'stop';

              controller.enqueue({ type: 'finish', reason });
            }
          }

          // Usage (typically in final chunk with stream_options.include_usage)
          if (data.usage) {
            controller.enqueue({
              type: 'usage',
              usage: {
                inputTokens: data.usage.prompt_tokens ?? 0,
                outputTokens: data.usage.completion_tokens ?? 0,
                reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
              },
            });
          }
        },
      });
    },
  };
}
