/**
 * Creates a ReadableStream<Uint8Array> that emits valid Anthropic SSE events,
 * simulating what `fetch('/api/chat').then(r => r.body)` would return.
 *
 * The stream follows the Anthropic streaming protocol:
 *   message_start -> content_block_start -> content_block_delta (per chunk) ->
 *   content_block_stop -> message_delta -> message_stop
 */

const encoder = new TextEncoder();

function sseEvent(event: string, data: object): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockAnthropicStream(
  text: string,
  delayMs: number = 30,
): ReadableStream<Uint8Array> {
  const words = text.split(/(\s+)/); // preserve whitespace as separate tokens

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 1. message_start
        controller.enqueue(
          sseEvent('message_start', {
            type: 'message_start',
            message: {
              id: `msg_mock_${Date.now()}`,
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 25, output_tokens: 1 },
            },
          }),
        );

        await delay(delayMs);

        // 2. content_block_start
        controller.enqueue(
          sseEvent('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        );

        await delay(delayMs);

        // 3. content_block_delta for each token
        for (const word of words) {
          if (word === '') continue;
          controller.enqueue(
            sseEvent('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: word },
            }),
          );
          await delay(delayMs + Math.random() * 20);
        }

        // 4. content_block_stop
        controller.enqueue(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: 0,
          }),
        );

        await delay(delayMs);

        // 5. message_delta (stop reason + final usage)
        const outputTokens = Math.max(1, Math.ceil(words.length * 1.3));
        controller.enqueue(
          sseEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: outputTokens },
          }),
        );

        await delay(delayMs);

        // 6. message_stop
        controller.enqueue(
          sseEvent('message_stop', {
            type: 'message_stop',
          }),
        );

        controller.close();
      } catch {
        controller.close();
      }
    },
  });
}

/** Canned responses for the mock assistant. */
export const CANNED_RESPONSES = [
  "That's a great question! Let me think about this carefully. The key insight here is that state management for AI streams requires handling both the synchronous UI updates and the asynchronous nature of token-by-token streaming. This library bridges that gap by providing a unified store that any framework adapter can subscribe to.",

  "Here's how I'd approach that problem: First, you'd want to separate your streaming logic from your UI layer. The store-ai library does exactly this by providing a framework-agnostic core that manages the stream lifecycle, while adapters like the React hooks or Zustand bridge handle the rendering side. This means you can switch between frameworks without changing your AI integration code.",

  'Interesting! There are a few things worth considering here. Server-Sent Events (SSE) are the standard protocol that most AI providers use for streaming responses. The SSE parser in store-ai handles all the edge cases - multi-line data fields, reconnection, and provider-specific event formats. Each provider adapter then transforms those raw SSE events into a unified stream of typed events.',

  "I appreciate you asking about that. The middleware system is one of the most powerful features. You can compose middleware like logging, throttling, cost tracking, and persistence to build exactly the pipeline you need. Each middleware can inspect, transform, or even block events before they reach the store. It's similar to Express middleware but for AI stream events.",

  "Let me walk you through the architecture. At the core, there's a simple reducer that manages state transitions: idle -> streaming -> complete. Each stream event (text-delta, tool-call-start, usage, etc.) maps to a store action. The store notifies subscribers via a batching strategy - microtask by default for optimal React rendering, but configurable to RAF or synchronous updates.",
];

export function pickResponse(): string {
  return CANNED_RESPONSES[Math.floor(Math.random() * CANNED_RESPONSES.length)]!;
}
