/**
 * Creates a mock Anthropic-format SSE byte stream that emits text token by token.
 *
 * Produces the full event sequence the anthropic() provider adapter expects:
 *   message_start -> content_block_start -> content_block_delta (x N) ->
 *   content_block_stop -> message_delta (stop_reason) -> message_stop
 */
export function createMockAnthropicStream(text: string, delayMs = 30): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const tokens = tokenize(text);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // message_start
      emit(controller, encoder, 'message_start', {
        type: 'message_start',
        message: {
          id: 'msg_mock_' + Date.now(),
          type: 'message',
          role: 'assistant',
          model: 'mock-model',
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });

      // content_block_start (text block)
      emit(controller, encoder, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });

      // stream tokens as content_block_delta events
      for (const token of tokens) {
        await delay(delayMs);
        emit(controller, encoder, 'content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: token },
        });
      }

      // content_block_stop
      emit(controller, encoder, 'content_block_stop', {
        type: 'content_block_stop',
        index: 0,
      });

      // message_delta with stop reason
      emit(controller, encoder, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: tokens.length },
      });

      // message_stop
      emit(controller, encoder, 'message_stop', { type: 'message_stop' });

      controller.close();
    },
  });
}

/** Encode and enqueue a single SSE frame. */
function emit(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(frame));
}

/** Split text into small token-like chunks (words + trailing whitespace). */
function tokenize(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of text) {
    current += ch;
    if (ch === ' ' || ch === '\n' || ch === '.' || ch === ',') {
      parts.push(current);
      current = '';
    }
  }
  if (current) parts.push(current);
  return parts;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
