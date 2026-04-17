import { describe, it, expect } from 'vitest';
import { openaiResponses } from '../../src/providers/openai-responses.js';
import type { SSEEvent, StreamEvent } from '../../src/types.js';

async function transformEvents(sseEvents: SSEEvent[]): Promise<StreamEvent[]> {
  const transform = openaiResponses().createTransform();
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

/** Build a named SSE event with a JSON payload. */
function sse(event: string, data: Record<string, unknown>): SSEEvent {
  return { event, data: JSON.stringify(data) };
}

describe('openai-responses provider', () => {
  it('has the correct name', () => {
    expect(openaiResponses().name).toBe('openai-responses');
  });

  // ── Text streaming ──────────────────────────────────────────────────

  describe('text streaming', () => {
    it('emits text-delta events for output_text.delta', async () => {
      const events = await transformEvents([
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: 'Hello',
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: ' world',
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: ' world' });
    });

    it('ignores output_text.delta with no delta field', async () => {
      const events = await transformEvents([
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('does not emit events for output_text.done', async () => {
      const events = await transformEvents([
        sse('response.output_text.done', {
          type: 'response.output_text.done',
          text: 'Hello world',
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });
  });

  // ── Reasoning ───────────────────────────────────────────────────────

  describe('reasoning', () => {
    it('emits thinking-delta events for reasoning_text.delta', async () => {
      const events = await transformEvents([
        sse('response.reasoning_text.delta', {
          type: 'response.reasoning_text.delta',
          delta: 'Let me think...',
        }),
        sse('response.reasoning_text.delta', {
          type: 'response.reasoning_text.delta',
          delta: ' The answer is 42.',
        }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(2);
      expect(thinkingDeltas[0]).toEqual({ type: 'thinking-delta', text: 'Let me think...' });
      expect(thinkingDeltas[1]).toEqual({
        type: 'thinking-delta',
        text: ' The answer is 42.',
      });
    });

    it('ignores reasoning_text.delta with no delta field', async () => {
      const events = await transformEvents([
        sse('response.reasoning_text.delta', {
          type: 'response.reasoning_text.delta',
        }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(0);
    });

    it('does not emit events for reasoning_text.done', async () => {
      const events = await transformEvents([
        sse('response.reasoning_text.done', {
          type: 'response.reasoning_text.done',
          text: 'Full reasoning text here.',
        }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(0);
    });
  });

  // ── Function calls ──────────────────────────────────────────────────

  describe('function calls', () => {
    it('emits tool-call-start, tool-call-delta, and tool-call-end events', async () => {
      const events = await transformEvents([
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_001',
          call_id: 'call_abc123',
          name: 'get_weather',
          delta: '{"city":',
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_001',
          call_id: 'call_abc123',
          delta: '"SF"}',
        }),
        sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: 'item_001',
          call_id: 'call_abc123',
          name: 'get_weather',
          arguments: '{"city":"SF"}',
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

    it('handles done without prior deltas (emits start then end)', async () => {
      const events = await transformEvents([
        sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: 'item_002',
          call_id: 'call_xyz',
          name: 'no_args_tool',
          arguments: '{}',
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_xyz',
        name: 'no_args_tool',
      });

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_xyz',
        input: undefined,
      });
    });
  });

  // ── Multiple function calls ─────────────────────────────────────────

  describe('multiple function calls', () => {
    it('tracks multiple tool calls by item_id independently', async () => {
      const events = await transformEvents([
        // First tool call starts
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_weather',
          call_id: 'call_weather',
          name: 'get_weather',
          delta: '{"city":',
        }),
        // Second tool call starts
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_stock',
          call_id: 'call_stock',
          name: 'get_stock_price',
          delta: '{"ticker":',
        }),
        // More args for first
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_weather',
          call_id: 'call_weather',
          delta: '"NYC"}',
        }),
        // More args for second
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_stock',
          call_id: 'call_stock',
          delta: '"AAPL"}',
        }),
        // First completes
        sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: 'item_weather',
          call_id: 'call_weather',
          name: 'get_weather',
          arguments: '{"city":"NYC"}',
        }),
        // Second completes
        sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: 'item_stock',
          call_id: 'call_stock',
          name: 'get_stock_price',
          arguments: '{"ticker":"AAPL"}',
        }),
      ]);

      // Both should start
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

      // Deltas should be associated with correct call ids
      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(4);
      expect(deltas[0]).toEqual({
        type: 'tool-call-delta',
        id: 'call_weather',
        inputDelta: '{"city":',
      });
      expect(deltas[1]).toEqual({
        type: 'tool-call-delta',
        id: 'call_stock',
        inputDelta: '{"ticker":',
      });
      expect(deltas[2]).toEqual({
        type: 'tool-call-delta',
        id: 'call_weather',
        inputDelta: '"NYC"}',
      });
      expect(deltas[3]).toEqual({
        type: 'tool-call-delta',
        id: 'call_stock',
        inputDelta: '"AAPL"}',
      });

      // Both should end
      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(2);
      const endIds = ends.map((e) => (e as { id: string }).id).sort();
      expect(endIds).toEqual(['call_stock', 'call_weather']);
    });
  });

  // ── Model metadata ──────────────────────────────────────────────────

  describe('model metadata', () => {
    it('emits a metadata event from response.created', async () => {
      const events = await transformEvents([
        sse('response.created', {
          type: 'response.created',
          model: 'gpt-4o-2024-08-06',
          id: 'resp_abc123',
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

    it('does not emit metadata when model field is absent', async () => {
      const events = await transformEvents([
        sse('response.created', {
          type: 'response.created',
          id: 'resp_no_model',
        }),
      ]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(0);
    });
  });

  // ── Usage from response.completed ───────────────────────────────────

  describe('usage', () => {
    it('emits usage event from response.completed', async () => {
      const events = await transformEvents([
        sse('response.completed', {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 25,
              output_tokens: 100,
              total_tokens: 125,
              output_tokens_details: {
                reasoning_tokens: 30,
              },
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
        sse('response.completed', {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 50,
              total_tokens: 60,
            },
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

    it('handles response.completed without usage', async () => {
      const events = await transformEvents([
        sse('response.completed', {
          type: 'response.completed',
          response: {},
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(0);

      // Should still emit finish
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('emits finish event along with usage from response.completed', async () => {
      const events = await transformEvents([
        sse('response.completed', {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 5,
              output_tokens: 10,
              total_tokens: 15,
            },
          },
        }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── Error from response.failed ──────────────────────────────────────

  describe('error handling', () => {
    it('emits error event from response.failed with response.error', async () => {
      const events = await transformEvents([
        sse('response.failed', {
          type: 'response.failed',
          response: {
            error: {
              message: 'Rate limit exceeded',
              code: 'rate_limit',
            },
          },
        }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'Rate limit exceeded',
      );
    });

    it('emits error event from response.failed with top-level error', async () => {
      const events = await transformEvents([
        sse('response.failed', {
          type: 'response.failed',
          error: {
            message: 'Internal server error',
          },
        }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'Internal server error',
      );
    });

    it('emits default error message when no message is available', async () => {
      const events = await transformEvents([
        sse('response.failed', {
          type: 'response.failed',
        }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'OpenAI Responses API error',
      );
    });
  });

  // ── Cancelled ───────────────────────────────────────────────────────

  describe('cancelled', () => {
    it('emits finish(stop) from response.cancelled', async () => {
      const events = await transformEvents([
        sse('response.cancelled', {
          type: 'response.cancelled',
        }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── Malformed JSON ──────────────────────────────────────────────────

  describe('malformed JSON', () => {
    it('emits an error event for invalid JSON', async () => {
      const events = await transformEvents([
        { event: 'response.output_text.delta', data: '{invalid json}}}' },
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toContain(
        'Failed to parse OpenAI Responses SSE data',
      );
    });

    it('does not leak raw data in error message', async () => {
      const longData = 'x'.repeat(200);
      const events = await transformEvents([
        { event: 'response.output_text.delta', data: longData },
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      const msg = (errors[0] as { type: 'error'; error: Error }).error.message;
      expect(msg).toContain('200 chars');
      expect(msg).not.toContain('xxx');
    });

    it('continues processing after malformed JSON', async () => {
      const events = await transformEvents([
        { event: 'response.output_text.delta', data: 'not-json' },
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: 'hello',
        }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });

  // ── Full realistic stream ───────────────────────────────────────────

  describe('full realistic stream', () => {
    it('processes a complete text response end-to-end', async () => {
      const events = await transformEvents([
        sse('response.created', {
          type: 'response.created',
          id: 'resp_001',
          model: 'gpt-4o-2024-08-06',
          status: 'in_progress',
        }),
        sse('response.in_progress', {
          type: 'response.in_progress',
          id: 'resp_001',
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: 'Hello',
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: '!',
        }),
        sse('response.output_text.done', {
          type: 'response.output_text.done',
          text: 'Hello!',
        }),
        sse('response.completed', {
          type: 'response.completed',
          response: {
            id: 'resp_001',
            model: 'gpt-4o-2024-08-06',
            usage: {
              input_tokens: 9,
              output_tokens: 2,
              total_tokens: 11,
            },
          },
        }),
      ]);

      // Should have metadata, text deltas, usage, and finish
      const types = events.map((e) => e.type);
      expect(types).toContain('metadata');
      expect(types).toContain('text-delta');
      expect(types).toContain('usage');
      expect(types).toContain('finish');

      // Verify text content
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: '!' });

      // Verify model metadata
      const metadata = events.filter((e) => e.type === 'metadata');
      expect(metadata[0]).toEqual({
        type: 'metadata',
        key: 'model',
        value: 'gpt-4o-2024-08-06',
      });

      // Verify usage
      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { inputTokens: 9, outputTokens: 2, reasoningTokens: 0 },
      });

      // Verify finish
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('processes a complete tool call response end-to-end', async () => {
      const events = await transformEvents([
        sse('response.created', {
          type: 'response.created',
          id: 'resp_002',
          model: 'gpt-4o',
        }),
        sse('response.in_progress', {
          type: 'response.in_progress',
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_search',
          call_id: 'call_search',
          name: 'search',
          delta: '{"q',
        }),
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_search',
          call_id: 'call_search',
          delta: 'uery":"test"}',
        }),
        sse('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: 'item_search',
          call_id: 'call_search',
          name: 'search',
          arguments: '{"query":"test"}',
        }),
        sse('response.completed', {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 50,
              output_tokens: 20,
              total_tokens: 70,
            },
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
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('processes reasoning followed by text end-to-end', async () => {
      const events = await transformEvents([
        sse('response.created', {
          type: 'response.created',
          id: 'resp_003',
          model: 'o3-mini',
        }),
        sse('response.reasoning_text.delta', {
          type: 'response.reasoning_text.delta',
          delta: 'Let me think about this...',
        }),
        sse('response.reasoning_text.delta', {
          type: 'response.reasoning_text.delta',
          delta: ' The answer should be 42.',
        }),
        sse('response.reasoning_text.done', {
          type: 'response.reasoning_text.done',
          text: 'Let me think about this... The answer should be 42.',
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: 'The answer is 42.',
        }),
        sse('response.output_text.done', {
          type: 'response.output_text.done',
          text: 'The answer is 42.',
        }),
        sse('response.completed', {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 20,
              output_tokens: 10,
              total_tokens: 30,
              output_tokens_details: {
                reasoning_tokens: 15,
              },
            },
          },
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
        text: ' The answer should be 42.',
      });

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'The answer is 42.' });

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { inputTokens: 20, outputTokens: 10, reasoningTokens: 15 },
      });

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── State isolation ─────────────────────────────────────────────────

  describe('state isolation', () => {
    it('each createTransform() call gets independent state', async () => {
      const adapter = openaiResponses();

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
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_1',
          call_id: 'call_1',
          name: 'fn1',
          delta: '{"a":1}',
        }),
      );
      await writer1.close();
      await read1;

      // Second stream: same item_id should not be confused
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
        sse('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_1',
          call_id: 'call_1',
          name: 'fn1',
          delta: '{"b":2}',
        }),
      );
      await writer2.close();
      await read2;

      // Both streams should independently emit tool-call-start
      expect(events1.filter((e) => e.type === 'tool-call-start')).toHaveLength(1);
      expect(events2.filter((e) => e.type === 'tool-call-start')).toHaveLength(1);
    });
  });

  // ── Refusal ─────────────────────────────────────────────────────────

  describe('refusal', () => {
    it('surfaces refusal deltas as text-delta events', async () => {
      const events = await transformEvents([
        sse('response.refusal.delta', {
          type: 'response.refusal.delta',
          delta: 'I cannot help with that.',
        }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({
        type: 'text-delta',
        text: 'I cannot help with that.',
      });
    });
  });

  // ── Unknown events ──────────────────────────────────────────────────

  describe('unknown events', () => {
    it('ignores unrecognized event types', async () => {
      const events = await transformEvents([
        sse('response.output_item.added', {
          type: 'response.output_item.added',
          item: { id: 'item_1', type: 'message' },
        }),
        sse('response.output_text.delta', {
          type: 'response.output_text.delta',
          delta: 'hello',
        }),
      ]);

      // Only the text-delta should come through
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });
});
