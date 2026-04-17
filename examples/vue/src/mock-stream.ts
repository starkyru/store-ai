/**
 * Creates a mock ReadableStream<Uint8Array> that emits valid Anthropic SSE events.
 * Tokens are emitted with configurable delay to simulate real streaming.
 */
export function createMockAnthropicStream(text: string, delayMs = 30): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const tokens = text.split(/(?<=\s)|(?=\s)/);

  function sseEvent(event: string, data: object): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // message_start
      controller.enqueue(
        encoder.encode(
          sseEvent('message_start', {
            type: 'message_start',
            message: {
              id: 'msg_mock_' + Date.now(),
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [],
              usage: { input_tokens: 42, output_tokens: 0 },
            },
          }),
        ),
      );

      // content_block_start
      controller.enqueue(
        encoder.encode(
          sseEvent('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        ),
      );

      // Stream tokens one by one
      for (const token of tokens) {
        await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(
          encoder.encode(
            sseEvent('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: token },
            }),
          ),
        );
      }

      // content_block_stop
      controller.enqueue(
        encoder.encode(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: 0,
          }),
        ),
      );

      // message_delta with stop reason
      controller.enqueue(
        encoder.encode(
          sseEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: tokens.length },
          }),
        ),
      );

      // message_stop
      controller.enqueue(
        encoder.encode(
          sseEvent('message_stop', {
            type: 'message_stop',
          }),
        ),
      );

      controller.close();
    },
  });
}
