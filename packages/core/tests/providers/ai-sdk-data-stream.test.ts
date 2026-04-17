import { describe, it, expect } from 'vitest';
import { aiSdkDataStream } from '../../src/providers/ai-sdk-data-stream.js';
import type { SSEEvent, StreamEvent } from '../../src/types.js';

async function transformEvents(sseEvents: SSEEvent[]): Promise<StreamEvent[]> {
  const transform = aiSdkDataStream().createTransform();
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

/** Build an SSE event wrapping an AI SDK typed JSON object. */
function sse(data: Record<string, unknown>): SSEEvent {
  return { data: JSON.stringify(data) };
}

describe('ai-sdk-data-stream provider', () => {
  it('has the correct name', () => {
    expect(aiSdkDataStream().name).toBe('ai-sdk-data-stream');
  });

  // ── Text streaming ──────────────────────────────────────────────────

  describe('text streaming', () => {
    it('emits text-delta events', async () => {
      const events = await transformEvents([
        sse({ type: 'text-delta', textDelta: 'Hello' }),
        sse({ type: 'text-delta', textDelta: ' world' }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: ' world' });
    });

    it('ignores text-delta with empty textDelta', async () => {
      const events = await transformEvents([sse({ type: 'text-delta', textDelta: '' })]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('ignores text-delta with missing textDelta', async () => {
      const events = await transformEvents([sse({ type: 'text-delta' })]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });
  });

  // ── Tool call lifecycle ─────────────────────────────────────────────

  describe('tool call lifecycle', () => {
    it('emits tool-call-start, tool-call-delta, and tool-call-end events', async () => {
      const events = await transformEvents([
        sse({
          type: 'tool-call-start',
          toolCallId: 'call_123',
          toolName: 'get_weather',
        }),
        sse({
          type: 'tool-call-delta',
          toolCallId: 'call_123',
          argsTextDelta: '{"city":',
        }),
        sse({
          type: 'tool-call-delta',
          toolCallId: 'call_123',
          argsTextDelta: '"SF"}',
        }),
        sse({
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          args: { city: 'SF' },
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_123',
        name: 'get_weather',
      });

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(2);
      expect(deltas[0]).toEqual({
        type: 'tool-call-delta',
        id: 'call_123',
        inputDelta: '{"city":',
      });
      expect(deltas[1]).toEqual({
        type: 'tool-call-delta',
        id: 'call_123',
        inputDelta: '"SF"}',
      });

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_123',
        input: { city: 'SF' },
      });
    });

    it('handles tool-call without prior deltas', async () => {
      const events = await transformEvents([
        sse({
          type: 'tool-call',
          toolCallId: 'call_abc',
          toolName: 'no_args_tool',
          args: {},
        }),
      ]);

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_abc',
        input: {},
      });
    });

    it('ignores tool-result events', async () => {
      const events = await transformEvents([
        sse({
          type: 'tool-result',
          toolCallId: 'call_123',
          result: { temperature: 72 },
        }),
      ]);

      expect(events).toHaveLength(0);
    });
  });

  // ── Reasoning ───────────────────────────────────────────────────────

  describe('reasoning', () => {
    it('emits thinking-delta from reasoning events', async () => {
      const events = await transformEvents([
        sse({ type: 'reasoning', textDelta: 'Let me think...' }),
        sse({ type: 'reasoning', textDelta: ' The answer is 42.' }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(2);
      expect(thinkingDeltas[0]).toEqual({
        type: 'thinking-delta',
        text: 'Let me think...',
      });
      expect(thinkingDeltas[1]).toEqual({
        type: 'thinking-delta',
        text: ' The answer is 42.',
      });
    });

    it('emits thinking-delta from reasoning-delta events', async () => {
      const events = await transformEvents([
        sse({ type: 'reasoning-delta', textDelta: 'Reasoning here...' }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(1);
      expect(thinkingDeltas[0]).toEqual({
        type: 'thinking-delta',
        text: 'Reasoning here...',
      });
    });

    it('ignores reasoning with empty textDelta', async () => {
      const events = await transformEvents([sse({ type: 'reasoning', textDelta: '' })]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(0);
    });
  });

  // ── Usage from finish event ─────────────────────────────────────────

  describe('usage from finish event', () => {
    it('emits usage and finish events', async () => {
      const events = await transformEvents([
        sse({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 20 },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
        },
      });

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('handles finish without usage', async () => {
      const events = await transformEvents([sse({ type: 'finish', finishReason: 'stop' })]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(0);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('maps tool-calls finish reason', async () => {
      const events = await transformEvents([sse({ type: 'finish', finishReason: 'tool-calls' })]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'tool-calls' });
    });

    it('maps length finish reason', async () => {
      const events = await transformEvents([sse({ type: 'finish', finishReason: 'length' })]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'length' });
    });

    it('maps error finish reason', async () => {
      const events = await transformEvents([sse({ type: 'finish', finishReason: 'error' })]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'error' });
    });

    it('defaults unknown finish reason to stop', async () => {
      const events = await transformEvents([
        sse({ type: 'finish', finishReason: 'content-filter' }),
      ]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── Usage from step-finish event ────────────────────────────────────

  describe('usage from step-finish event', () => {
    it('emits usage and step-end events', async () => {
      const events = await transformEvents([
        sse({
          type: 'step-finish',
          finishReason: 'stop',
          usage: { promptTokens: 15, completionTokens: 30 },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 15,
          outputTokens: 30,
        },
      });

      const stepEnds = events.filter((e) => e.type === 'step-end');
      expect(stepEnds).toHaveLength(1);
      expect(stepEnds[0]).toEqual({ type: 'step-end', stepId: 'step_0' });
    });

    it('handles step-finish without usage', async () => {
      const events = await transformEvents([sse({ type: 'step-finish', finishReason: 'stop' })]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(0);

      const stepEnds = events.filter((e) => e.type === 'step-end');
      expect(stepEnds).toHaveLength(1);
    });

    it('increments step IDs across multiple step-finish events', async () => {
      const events = await transformEvents([
        sse({ type: 'step-finish', finishReason: 'tool-calls' }),
        sse({ type: 'step-finish', finishReason: 'stop' }),
      ]);

      const stepEnds = events.filter((e) => e.type === 'step-end');
      expect(stepEnds).toHaveLength(2);
      expect(stepEnds[0]).toEqual({ type: 'step-end', stepId: 'step_0' });
      expect(stepEnds[1]).toEqual({ type: 'step-end', stepId: 'step_1' });
    });
  });

  // ── Error event ─────────────────────────────────────────────────────

  describe('error event', () => {
    it('emits error from AI SDK error event', async () => {
      const events = await transformEvents([
        sse({ type: 'error', errorMessage: 'Rate limit exceeded' }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'Rate limit exceeded',
      );
    });

    it('uses default message when errorMessage is missing', async () => {
      const events = await transformEvents([sse({ type: 'error' })]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'AI SDK stream error',
      );
    });
  });

  // ── Malformed JSON ──────────────────────────────────────────────────

  describe('malformed JSON', () => {
    it('emits an error event for invalid JSON', async () => {
      const events = await transformEvents([{ data: '{invalid json}}}' }]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toContain(
        'Failed to parse AI SDK data stream',
      );
    });

    it('does not leak raw data in error message', async () => {
      const longData = 'x'.repeat(200);
      const events = await transformEvents([{ data: longData }]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      const msg = (errors[0] as { type: 'error'; error: Error }).error.message;
      expect(msg).toContain('200 bytes');
      expect(msg).not.toContain('xxx');
    });

    it('continues processing after malformed JSON', async () => {
      const events = await transformEvents([
        { data: 'not-json' },
        sse({ type: 'text-delta', textDelta: 'hello' }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });

  // ── Unknown event types ─────────────────────────────────────────────

  describe('unknown event types', () => {
    it('ignores unrecognized event types', async () => {
      const events = await transformEvents([
        sse({ type: 'source', sourceType: 'url', url: 'https://example.com' }),
        sse({ type: 'text-delta', textDelta: 'hello' }),
      ]);

      // Only the text-delta should come through
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });

    it('ignores events with no type field', async () => {
      const events = await transformEvents([
        sse({ data: 'something' }),
        sse({ type: 'text-delta', textDelta: 'hello' }),
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });

  // ── Full realistic stream ───────────────────────────────────────────

  describe('full realistic stream', () => {
    it('processes a complete text response end-to-end', async () => {
      const events = await transformEvents([
        sse({ type: 'text-delta', textDelta: 'Hello' }),
        sse({ type: 'text-delta', textDelta: ', ' }),
        sse({ type: 'text-delta', textDelta: 'world!' }),
        sse({
          type: 'step-finish',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
        sse({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toContain('text-delta');
      expect(types).toContain('usage');
      expect(types).toContain('step-end');
      expect(types).toContain('finish');

      // Verify text content
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(3);
      const fullText = textDeltas.map((e) => (e as { text: string }).text).join('');
      expect(fullText).toBe('Hello, world!');

      // Verify finish
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('processes a tool call flow end-to-end', async () => {
      const events = await transformEvents([
        sse({ type: 'text-delta', textDelta: 'Let me check the weather.' }),
        sse({
          type: 'tool-call-start',
          toolCallId: 'call_weather',
          toolName: 'get_weather',
        }),
        sse({
          type: 'tool-call-delta',
          toolCallId: 'call_weather',
          argsTextDelta: '{"city":',
        }),
        sse({
          type: 'tool-call-delta',
          toolCallId: 'call_weather',
          argsTextDelta: '"San Francisco"}',
        }),
        sse({
          type: 'tool-call',
          toolCallId: 'call_weather',
          toolName: 'get_weather',
          args: { city: 'San Francisco' },
        }),
        sse({
          type: 'step-finish',
          finishReason: 'tool-calls',
          usage: { promptTokens: 20, completionTokens: 15 },
        }),
        sse({
          type: 'tool-result',
          toolCallId: 'call_weather',
          result: { temperature: 65, condition: 'foggy' },
        }),
        sse({ type: 'text-delta', textDelta: 'It is 65F and foggy in SF.' }),
        sse({
          type: 'step-finish',
          finishReason: 'stop',
          usage: { promptTokens: 50, completionTokens: 10 },
        }),
        sse({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 50, completionTokens: 10 },
        }),
      ]);

      // Tool call lifecycle
      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect((starts[0] as { name: string }).name).toBe('get_weather');

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(2);
      const fullArgs = deltas.map((d) => (d as { inputDelta: string }).inputDelta).join('');
      expect(fullArgs).toBe('{"city":"San Francisco"}');

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_weather',
        input: { city: 'San Francisco' },
      });

      // Two step-ends (tool-calls step + final step)
      const stepEnds = events.filter((e) => e.type === 'step-end');
      expect(stepEnds).toHaveLength(2);
      expect(stepEnds[0]).toEqual({ type: 'step-end', stepId: 'step_0' });
      expect(stepEnds[1]).toEqual({ type: 'step-end', stepId: 'step_1' });

      // Two text deltas (before and after tool call)
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);

      // Tool result ignored
      const toolResults = events.filter((e) => e.type === ('tool-result' as any));
      expect(toolResults).toHaveLength(0);

      // Final finish
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('processes reasoning followed by text end-to-end', async () => {
      const events = await transformEvents([
        sse({ type: 'reasoning', textDelta: 'The user is asking about...' }),
        sse({ type: 'reasoning', textDelta: ' I should explain clearly.' }),
        sse({ type: 'text-delta', textDelta: 'Here is the answer.' }),
        sse({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 15, completionTokens: 25 },
        }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(2);
      expect(thinkingDeltas[0]).toEqual({
        type: 'thinking-delta',
        text: 'The user is asking about...',
      });
      expect(thinkingDeltas[1]).toEqual({
        type: 'thinking-delta',
        text: ' I should explain clearly.',
      });

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({
        type: 'text-delta',
        text: 'Here is the answer.',
      });

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { inputTokens: 15, outputTokens: 25 },
      });

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── State isolation ─────────────────────────────────────────────────

  describe('state isolation', () => {
    it('each createTransform() call gets independent step counters', async () => {
      const adapter = aiSdkDataStream();

      // First stream
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

      await writer1.write(sse({ type: 'step-finish', finishReason: 'stop' }));
      await writer1.close();
      await read1;

      // Second stream should start step counter from 0 again
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

      await writer2.write(sse({ type: 'step-finish', finishReason: 'stop' }));
      await writer2.close();
      await read2;

      const steps1 = events1.filter((e) => e.type === 'step-end');
      const steps2 = events2.filter((e) => e.type === 'step-end');
      expect(steps1[0]).toEqual({ type: 'step-end', stepId: 'step_0' });
      expect(steps2[0]).toEqual({ type: 'step-end', stepId: 'step_0' });
    });
  });
});
