import { describe, it, expect } from 'vitest';
import { createAIStore } from '../src/store.js';
import { anthropic } from '../src/providers/anthropic.js';
import { openai } from '../src/providers/openai.js';
import type { SSEEvent, StreamEvent, ProviderAdapter } from '../src/types.js';

/**
 * Runs an array of SSEEvents through a provider adapter's transform,
 * collecting the resulting StreamEvents.
 */
async function runProvider(
  provider: ProviderAdapter,
  sseEvents: SSEEvent[],
): Promise<StreamEvent[]> {
  const transform = provider.createTransform();
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const results: StreamEvent[] = [];

  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value);
    }
  })();

  for (const event of sseEvents) {
    await writer.write(event);
  }
  await writer.close();
  await readAll;

  return results;
}

function sse(event: string, data: unknown): SSEEvent {
  return { event, data: JSON.stringify(data) };
}

function ssePlain(data: unknown): SSEEvent {
  return { data: JSON.stringify(data) };
}

/** Feed StreamEvents into a store and wait for completion. */
async function feedStore(
  events: StreamEvent[],
  providerAdapter?: ProviderAdapter,
): Promise<ReturnType<typeof createAIStore>> {
  const store = createAIStore({ batchStrategy: 'sync', provider: providerAdapter });

  async function* eventGenerator(): AsyncGenerator<StreamEvent> {
    for (const event of events) {
      yield event;
    }
  }

  store.submit({ events: eventGenerator() });

  // Wait for async consumption
  await new Promise<void>((r) => setTimeout(r, 50));

  return store;
}

describe('cross-provider equivalence', () => {
  it('Anthropic and OpenAI produce equivalent AIState for "Hello world" text response', async () => {
    // -- Anthropic SSE sequence for "Hello world" --
    const anthropicSSE: SSEEvent[] = [
      sse('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }),
      sse('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      }),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      }),
      sse('message_stop', { type: 'message_stop' }),
    ];

    // -- OpenAI SSE sequence for "Hello world" --
    const openaiSSE: SSEEvent[] = [
      ssePlain({
        id: 'chatcmpl-01',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      }),
      ssePlain({
        id: 'chatcmpl-01',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      }),
      ssePlain({
        id: 'chatcmpl-01',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
      }),
      ssePlain({
        id: 'chatcmpl-01',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    ];

    // Run both through their respective provider adapters
    const anthropicEvents = await runProvider(anthropic(), anthropicSSE);
    const openaiEvents = await runProvider(openai(), openaiSSE);

    // Feed normalized StreamEvents into separate stores
    const anthropicStore = await feedStore(anthropicEvents);
    const openaiStore = await feedStore(openaiEvents);

    // Both stores should have the same final state for the key fields
    expect(anthropicStore.get('status')).toBe('complete');
    expect(openaiStore.get('status')).toBe('complete');

    expect(anthropicStore.get('text')).toBe('Hello world');
    expect(openaiStore.get('text')).toBe('Hello world');

    // Both should have one assistant message
    const anthropicMessages = anthropicStore.get('messages');
    const openaiMessages = openaiStore.get('messages');
    expect(anthropicMessages).toHaveLength(1);
    expect(openaiMessages).toHaveLength(1);

    expect(anthropicMessages[0]!.role).toBe('assistant');
    expect(openaiMessages[0]!.role).toBe('assistant');

    // Both assistant messages should contain text content "Hello world"
    const anthropicTextContent = anthropicMessages[0]!.content.find((c) => c.type === 'text');
    const openaiTextContent = openaiMessages[0]!.content.find((c) => c.type === 'text');
    expect(anthropicTextContent).toBeDefined();
    expect(openaiTextContent).toBeDefined();
    expect(anthropicTextContent!.type).toBe('text');
    expect(openaiTextContent!.type).toBe('text');
    if (anthropicTextContent!.type === 'text' && openaiTextContent!.type === 'text') {
      expect(anthropicTextContent!.text).toBe('Hello world');
      expect(openaiTextContent!.text).toBe('Hello world');
    }
  });

  it('both providers emit text-delta StreamEvents for text content', async () => {
    const anthropicSSE: SSEEvent[] = [
      sse('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hi' },
      }),
    ];

    const openaiSSE: SSEEvent[] = [
      ssePlain({
        id: 'chatcmpl-02',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
      }),
    ];

    const anthropicEvents = await runProvider(anthropic(), anthropicSSE);
    const openaiEvents = await runProvider(openai(), openaiSSE);

    const anthropicTextDeltas = anthropicEvents.filter((e) => e.type === 'text-delta');
    const openaiTextDeltas = openaiEvents.filter((e) => e.type === 'text-delta');

    expect(anthropicTextDeltas).toHaveLength(1);
    expect(openaiTextDeltas).toHaveLength(1);
    expect(anthropicTextDeltas[0]).toEqual({ type: 'text-delta', text: 'Hi' });
    expect(openaiTextDeltas[0]).toEqual({ type: 'text-delta', text: 'Hi' });
  });

  it('both providers emit finish StreamEvent with reason "stop"', async () => {
    const anthropicSSE: SSEEvent[] = [
      sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
      }),
    ];

    const openaiSSE: SSEEvent[] = [
      ssePlain({
        id: 'chatcmpl-03',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    ];

    const anthropicEvents = await runProvider(anthropic(), anthropicSSE);
    const openaiEvents = await runProvider(openai(), openaiSSE);

    const anthropicFinish = anthropicEvents.find((e) => e.type === 'finish');
    const openaiFinish = openaiEvents.find((e) => e.type === 'finish');

    expect(anthropicFinish).toEqual({ type: 'finish', reason: 'stop' });
    expect(openaiFinish).toEqual({ type: 'finish', reason: 'stop' });
  });
});
