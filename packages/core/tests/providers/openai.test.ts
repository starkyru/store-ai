import { describe, it, expect } from 'vitest';
import { openai } from '../../src/providers/openai.js';
import type { SSEEvent, StreamEvent } from '../../src/types.js';

async function transformEvents(sseEvents: SSEEvent[]): Promise<StreamEvent[]> {
  const transform = openai().createTransform();
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const events: StreamEvent[] = [];

  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  })();

  for (const sse of sseEvents) {
    await writer.write(sse);
  }
  await writer.close();
  await readAll;

  return events;
}

/** Build a data-only SSE event with a JSON payload. */
function sse(data: Record<string, unknown>): SSEEvent {
  return { data: JSON.stringify(data) };
}

describe('openai provider', () => {
  it('has the correct name', () => {
    expect(openai().name).toBe('openai');
  });

  // ── Text streaming ──────────────────────────────────────────────────

  describe('text streaming', () => {
    it('emits text-delta events for content chunks', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-abc',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        }),
        sse({
          id: 'chatcmpl-abc',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: ' world' });
    });

    it('handles a single-token response', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-x',
          object: 'chat.completion.chunk',
          model: 'gpt-4o-mini',
          choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
        }),
        sse({
          id: 'chatcmpl-x',
          object: 'chat.completion.chunk',
          model: 'gpt-4o-mini',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'OK' });
    });
  });

  // ── Tool calls ──────────────────────────────────────────────────────

  describe('tool calls', () => {
    it('emits tool-call-start, tool-call-delta, and tool-call-end events', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-tc1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_abc123',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tc1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"city":' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tc1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"SF"}' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tc1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_abc123',
        name: 'get_weather',
      });

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(2);
      expect(deltas[0]).toEqual({
        type: 'tool-call-delta',
        id: 'call_abc123',
        inputDelta: '{"city":',
      });
      expect(deltas[1]).toEqual({
        type: 'tool-call-delta',
        id: 'call_abc123',
        inputDelta: '"SF"}',
      });

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_abc123',
        input: undefined,
      });
    });

    it('handles tool call with empty arguments first chunk', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-tc2',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_empty',
                    type: 'function',
                    function: { name: 'no_args_tool', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tc2',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_empty',
        name: 'no_args_tool',
      });

      // Empty string arguments should not produce a delta
      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(0);
    });
  });

  // ── Multiple simultaneous tool calls ────────────────────────────────

  describe('multiple simultaneous tool calls', () => {
    it('handles two tool calls with different indices arriving interleaved', async () => {
      const events = await transformEvents([
        // First tool call starts
        sse({
          id: 'chatcmpl-multi',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_weather',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        // Second tool call starts
        sse({
          id: 'chatcmpl-multi',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'call_stock',
                    type: 'function',
                    function: { name: 'get_stock_price', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        // Arguments for first tool call
        sse({
          id: 'chatcmpl-multi',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        // Arguments for second tool call
        sse({
          id: 'chatcmpl-multi',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 1, function: { arguments: '{"ticker":' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        // More arguments for second tool call
        sse({
          id: 'chatcmpl-multi',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 1, function: { arguments: '"AAPL"}' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        // Finish with tool_calls
        sse({
          id: 'chatcmpl-multi',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
      ]);

      // Both tool calls should start
      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(2);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_weather',
        name: 'get_weather',
      });
      expect(starts[1]).toEqual({
        type: 'tool-call-start',
        id: 'call_stock',
        name: 'get_stock_price',
      });

      // Deltas should be associated with the correct tool call ids
      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(3);
      expect(deltas[0]).toEqual({
        type: 'tool-call-delta',
        id: 'call_weather',
        inputDelta: '{"city":"NYC"}',
      });
      expect(deltas[1]).toEqual({
        type: 'tool-call-delta',
        id: 'call_stock',
        inputDelta: '{"ticker":',
      });
      expect(deltas[2]).toEqual({
        type: 'tool-call-delta',
        id: 'call_stock',
        inputDelta: '"AAPL"}',
      });

      // Both tool calls should end
      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(2);
      const endIds = ends.map((e) => (e as { id: string }).id).sort();
      expect(endIds).toEqual(['call_stock', 'call_weather']);

      // Finish reason should be tool-calls
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'tool-calls' });
    });

    it('handles both tool calls arriving in the same SSE chunk', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-batch',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_a',
                    type: 'function',
                    function: { name: 'tool_a', arguments: '' },
                  },
                  {
                    index: 1,
                    id: 'call_b',
                    type: 'function',
                    function: { name: 'tool_b', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-batch',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(2);
      expect(starts[0]).toEqual({ type: 'tool-call-start', id: 'call_a', name: 'tool_a' });
      expect(starts[1]).toEqual({ type: 'tool-call-start', id: 'call_b', name: 'tool_b' });
    });
  });

  // ── Reasoning content ───────────────────────────────────────────────

  describe('reasoning content', () => {
    it('emits thinking-delta events for reasoning_content', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-reason',
          object: 'chat.completion.chunk',
          model: 'o1',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: 'Let me think about this...' },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-reason',
          object: 'chat.completion.chunk',
          model: 'o1',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: ' The answer is 42.' },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-reason',
          object: 'chat.completion.chunk',
          model: 'o1',
          choices: [{ index: 0, delta: { content: 'The answer is 42.' }, finish_reason: null }],
        }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(2);
      expect(thinkingDeltas[0]).toEqual({
        type: 'thinking-delta',
        text: 'Let me think about this...',
      });
      expect(thinkingDeltas[1]).toEqual({
        type: 'thinking-delta',
        text: ' The answer is 42.',
      });

      // Text content should also be present
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'The answer is 42.' });
    });

    it('handles chunk with both reasoning_content and content', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-both',
          object: 'chat.completion.chunk',
          model: 'o1',
          choices: [
            {
              index: 0,
              delta: { reasoning_content: 'thinking...', content: 'answer' },
              finish_reason: null,
            },
          ],
        }),
      ]);

      const thinking = events.filter((e) => e.type === 'thinking-delta');
      const text = events.filter((e) => e.type === 'text-delta');
      expect(thinking).toHaveLength(1);
      expect(text).toHaveLength(1);
      expect(thinking[0]).toEqual({ type: 'thinking-delta', text: 'thinking...' });
      expect(text[0]).toEqual({ type: 'text-delta', text: 'answer' });
    });
  });

  // ── Finish reasons ──────────────────────────────────────────────────

  describe('finish reasons', () => {
    it('maps "stop" to "stop"', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-stop',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('maps "tool_calls" to "tool-calls"', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-tc',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'tool-calls' });
    });

    it('maps "length" to "length"', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-len',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
        }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'length' });
    });

    it('maps unknown finish reason to "stop"', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-unk',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }],
        }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── Usage ───────────────────────────────────────────────────────────

  describe('usage in final chunk', () => {
    it('emits a usage event with token counts', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-usage',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [],
          usage: {
            prompt_tokens: 25,
            completion_tokens: 100,
            total_tokens: 125,
            completion_tokens_details: {
              reasoning_tokens: 30,
            },
          },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 25,
          outputTokens: 100,
          reasoningTokens: 30,
        },
      });
    });

    it('handles usage without reasoning token details', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-usage2',
          object: 'chat.completion.chunk',
          model: 'gpt-4o-mini',
          choices: [],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 50,
            total_tokens: 60,
          },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 50,
          reasoningTokens: 0,
        },
      });
    });

    it('handles usage with missing fields defaulting to 0', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-usage3',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [],
          usage: {},
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
      });
    });
  });

  // ── Model metadata ──────────────────────────────────────────────────

  describe('model metadata', () => {
    it('emits a metadata event with the model name', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-meta',
          object: 'chat.completion.chunk',
          model: 'gpt-4o-2024-08-06',
          choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
        }),
      ]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(1);
      expect(metadataEvents[0]).toEqual({
        type: 'metadata',
        key: 'model',
        value: 'gpt-4o-2024-08-06',
      });
    });

    it('emits metadata for each chunk that includes a model field', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-m1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: 'A' }, finish_reason: null }],
        }),
        sse({
          id: 'chatcmpl-m1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: 'B' }, finish_reason: null }],
        }),
      ]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(2);
    });

    it('does not emit metadata when model field is absent', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-nomodel',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
        }),
      ]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(0);
    });
  });

  // ── Malformed JSON ──────────────────────────────────────────────────

  describe('malformed JSON', () => {
    it('emits an error event for invalid JSON', async () => {
      const events = await transformEvents([{ data: '{invalid json}}}' }]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.type).toBe('error');
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toContain(
        'Failed to parse OpenAI SSE data',
      );
    });

    it('continues processing after malformed JSON', async () => {
      const events = await transformEvents([
        { data: 'not-json' },
        sse({
          id: 'chatcmpl-ok',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
        }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });

    it('includes the raw data in the error message', async () => {
      const rawData = '{"truncated":';
      const events = await transformEvents([{ data: rawData }]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toContain(rawData);
    });
  });

  // ── Empty delta ─────────────────────────────────────────────────────

  describe('empty delta', () => {
    it('emits no text-delta or thinking-delta for null content', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-empty',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: null }, finish_reason: null }],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(textDeltas).toHaveLength(0);
      expect(thinkingDeltas).toHaveLength(0);
    });

    it('emits no text-delta for undefined content in delta', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-empty2',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: null }],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      const toolEvents = events.filter(
        (e) =>
          e.type === 'tool-call-start' ||
          e.type === 'tool-call-delta' ||
          e.type === 'tool-call-end',
      );
      expect(textDeltas).toHaveLength(0);
      expect(thinkingDeltas).toHaveLength(0);
      expect(toolEvents).toHaveLength(0);
    });

    it('emits no text-delta for empty string content', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-empty3',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: '' }, finish_reason: null }],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('emits no events for chunk with no choices', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-nochoice',
          object: 'chat.completion.chunk',
          choices: [],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      const finishes = events.filter((e) => e.type === 'finish');
      expect(textDeltas).toHaveLength(0);
      expect(finishes).toHaveLength(0);
    });

    it('handles chunk with no delta at all', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-nodelta',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, finish_reason: null }],
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });
  });

  // ── Full realistic stream ───────────────────────────────────────────

  describe('full realistic stream', () => {
    it('processes a complete text response end-to-end', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-full',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o-2024-08-06',
          system_fingerprint: 'fp_abc123',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }),
        sse({
          id: 'chatcmpl-full',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o-2024-08-06',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        }),
        sse({
          id: 'chatcmpl-full',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o-2024-08-06',
          choices: [{ index: 0, delta: { content: '!' }, finish_reason: null }],
        }),
        sse({
          id: 'chatcmpl-full',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o-2024-08-06',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
        sse({
          id: 'chatcmpl-full',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o-2024-08-06',
          choices: [],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 2,
            total_tokens: 11,
          },
        }),
      ]);

      // Should have metadata, text deltas, finish, and usage
      const types = events.map((e) => e.type);
      expect(types).toContain('metadata');
      expect(types).toContain('text-delta');
      expect(types).toContain('finish');
      expect(types).toContain('usage');

      // Verify text content
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: '!' });

      // Verify finish
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });

      // Verify usage
      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { inputTokens: 9, outputTokens: 2, reasoningTokens: 0 },
      });
    });

    it('processes a complete tool call response end-to-end', async () => {
      const events = await transformEvents([
        sse({
          id: 'chatcmpl-tools',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_search',
                    type: 'function',
                    function: { name: 'search', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tools',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"q' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tools',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'uery":"test"}' } }],
              },
              finish_reason: null,
            },
          ],
        }),
        sse({
          id: 'chatcmpl-tools',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
        sse({
          id: 'chatcmpl-tools',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'gpt-4o',
          choices: [],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 20,
            total_tokens: 70,
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect((starts[0] as { name: string }).name).toBe('search');

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(2);
      const fullArgs = deltas.map((d) => (d as { inputDelta: string }).inputDelta).join('');
      expect(fullArgs).toBe('{"query":"test"}');

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'tool-calls' });
    });
  });

  // ── State isolation ─────────────────────────────────────────────────

  describe('state isolation', () => {
    it('each createTransform() call gets independent state', async () => {
      const adapter = openai();

      // First stream: start a tool call
      const transform1 = adapter.createTransform();
      const writer1 = transform1.writable.getWriter();
      const reader1 = transform1.readable.getReader();
      const events1: StreamEvent[] = [];

      const read1 = (async () => {
        while (true) {
          const { done, value } = await reader1.read();
          if (done) break;
          events1.push(value);
        }
      })();

      await writer1.write(
        sse({
          id: 'chatcmpl-iso1',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'fn1', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      await writer1.close();
      await read1;

      // Second stream: should not see tool call from first
      const transform2 = adapter.createTransform();
      const writer2 = transform2.writable.getWriter();
      const reader2 = transform2.readable.getReader();
      const events2: StreamEvent[] = [];

      const read2 = (async () => {
        while (true) {
          const { done, value } = await reader2.read();
          if (done) break;
          events2.push(value);
        }
      })();

      await writer2.write(
        sse({
          id: 'chatcmpl-iso2',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      await writer2.close();
      await read2;

      // First stream should have a tool-call-start
      expect(events1.filter((e) => e.type === 'tool-call-start')).toHaveLength(1);

      // Second stream should NOT have a tool-call-delta (no active tool call at index 0)
      const deltas2 = events2.filter((e) => e.type === 'tool-call-delta');
      expect(deltas2).toHaveLength(0);
    });
  });
});
