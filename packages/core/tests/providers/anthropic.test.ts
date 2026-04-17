import { describe, it, expect } from 'vitest';
import { anthropic } from '../../src/providers/anthropic.js';
import type { SSEEvent, StreamEvent } from '../../src/types.js';

async function transformEvents(sseEvents: SSEEvent[]): Promise<StreamEvent[]> {
  const transform = anthropic().createTransform();
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

describe('anthropic provider', () => {
  it('has correct name', () => {
    const provider = anthropic();
    expect(provider.name).toBe('anthropic');
  });

  describe('text streaming', () => {
    it('emits text-delta events for a full text conversation', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 25, output_tokens: 1 },
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
          delta: { type: 'text_delta', text: ', ' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'world!' },
        }),
        sse('content_block_stop', {
          type: 'content_block_stop',
          index: 0,
        }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 12 },
        }),
        sse('message_stop', { type: 'message_stop' }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(3);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: ', ' });
      expect(textDeltas[2]).toEqual({ type: 'text-delta', text: 'world!' });
    });

    it('produces the expected sequence of event types for a full conversation', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01A',
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
          delta: { type: 'text_delta', text: 'Hi' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        }),
        sse('message_stop', { type: 'message_stop' }),
      ]);

      const types = events.map((e) => e.type);
      expect(types).toEqual(['metadata', 'usage', 'text-delta', 'usage', 'finish']);
    });
  });

  describe('thinking blocks', () => {
    it('emits thinking-delta events for thinking content', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01B',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 15, output_tokens: 1 },
          },
        }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me reason about this' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' step by step...' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'The answer is 42.' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 1 }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 30 },
        }),
        sse('message_stop', { type: 'message_stop' }),
      ]);

      const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta');
      expect(thinkingDeltas).toHaveLength(2);
      expect(thinkingDeltas[0]).toEqual({
        type: 'thinking-delta',
        text: 'Let me reason about this',
      });
      expect(thinkingDeltas[1]).toEqual({
        type: 'thinking-delta',
        text: ' step by step...',
      });

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'The answer is 42.' });
    });
  });

  describe('tool calls', () => {
    it('emits tool-call-start, tool-call-delta, and tool-call-end events', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01C',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 20, output_tokens: 1 },
          },
        }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_01A09q90qw90lq917835lq9',
            name: 'get_weather',
          },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"lo' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: 'cation": "San' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: ' Francisco"}' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 18 },
        }),
        sse('message_stop', { type: 'message_stop' }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'toolu_01A09q90qw90lq917835lq9',
        name: 'get_weather',
      });

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(3);
      expect(deltas[0]).toEqual({
        type: 'tool-call-delta',
        id: 'toolu_01A09q90qw90lq917835lq9',
        inputDelta: '{"lo',
      });
      expect(deltas[1]).toEqual({
        type: 'tool-call-delta',
        id: 'toolu_01A09q90qw90lq917835lq9',
        inputDelta: 'cation": "San',
      });
      expect(deltas[2]).toEqual({
        type: 'tool-call-delta',
        id: 'toolu_01A09q90qw90lq917835lq9',
        inputDelta: ' Francisco"}',
      });

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'toolu_01A09q90qw90lq917835lq9',
        input: undefined,
      });
    });

    it('handles multiple sequential tool calls', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01D',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 30, output_tokens: 1 },
          },
        }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_first',
            name: 'get_weather',
          },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"city":"NY"}' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sse('content_block_start', {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'toolu_second',
            name: 'get_time',
          },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"tz":"EST"}' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 1 }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 25 },
        }),
        sse('message_stop', { type: 'message_stop' }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(2);
      expect(starts[0]).toMatchObject({ id: 'toolu_first', name: 'get_weather' });
      expect(starts[1]).toMatchObject({ id: 'toolu_second', name: 'get_time' });

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas[0]).toMatchObject({ id: 'toolu_first', inputDelta: '{"city":"NY"}' });
      expect(deltas[1]).toMatchObject({ id: 'toolu_second', inputDelta: '{"tz":"EST"}' });

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(2);
      expect(ends[0]).toMatchObject({ id: 'toolu_first' });
      expect(ends[1]).toMatchObject({ id: 'toolu_second' });
    });

    it('does not emit tool-call-delta when no tool call is active', async () => {
      const events = await transformEvents([
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"orphan":true}' },
        }),
      ]);

      const deltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(deltas).toHaveLength(0);
    });

    it('resets tool call state after content_block_stop', async () => {
      const events = await transformEvents([
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_abc', name: 'search' },
        }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        // Now a text block starts; input_json_delta should not produce tool-call-delta
        sse('content_block_start', {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
        }),
      ]);

      const toolDeltas = events.filter((e) => e.type === 'tool-call-delta');
      expect(toolDeltas).toHaveLength(0);
    });
  });

  describe('usage extraction', () => {
    it('emits usage from message_start', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01E',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 100, output_tokens: 5 },
          },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 100,
          outputTokens: 5,
          reasoningTokens: 0,
        },
      });
    });

    it('emits usage from message_delta', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 42 },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { outputTokens: 42 },
      });
    });

    it('emits both initial and final usage events', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01F',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 50, output_tokens: 1 },
          },
        }),
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 150 },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(2);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { inputTokens: 50, outputTokens: 1, reasoningTokens: 0 },
      });
      expect(usageEvents[1]).toEqual({
        type: 'usage',
        usage: { outputTokens: 150 },
      });
    });

    it('handles missing usage fields gracefully', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01G',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: {},
          },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]).toEqual({
        type: 'usage',
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      });
    });

    it('does not emit usage when message_delta has no usage field', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
        }),
      ]);

      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents).toHaveLength(0);
    });
  });

  describe('model metadata', () => {
    it('emits metadata event with model from message_start', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01H',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-20250514',
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        }),
      ]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(1);
      expect(metadataEvents[0]).toEqual({
        type: 'metadata',
        key: 'model',
        value: 'claude-sonnet-4-20250514',
      });
    });

    it('does not emit metadata when model is missing', async () => {
      const events = await transformEvents([
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_01I',
            type: 'message',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        }),
      ]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(0);
    });

    it('does not emit metadata when message is missing', async () => {
      const events = await transformEvents([sse('message_start', { type: 'message_start' })]);

      const metadataEvents = events.filter((e) => e.type === 'metadata');
      expect(metadataEvents).toHaveLength(0);
    });
  });

  describe('finish reasons', () => {
    it('maps end_turn to stop', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
        }),
      ]);

      const finish = events.find((e) => e.type === 'finish');
      expect(finish).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('maps tool_use to tool-calls', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
        }),
      ]);

      const finish = events.find((e) => e.type === 'finish');
      expect(finish).toEqual({ type: 'finish', reason: 'tool-calls' });
    });

    it('maps max_tokens to length', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens' },
        }),
      ]);

      const finish = events.find((e) => e.type === 'finish');
      expect(finish).toEqual({ type: 'finish', reason: 'length' });
    });

    it('maps unknown stop reason to stop', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'some_future_reason' },
        }),
      ]);

      const finish = events.find((e) => e.type === 'finish');
      expect(finish).toEqual({ type: 'finish', reason: 'stop' });
    });

    it('does not emit finish when stop_reason is absent', async () => {
      const events = await transformEvents([
        sse('message_delta', {
          type: 'message_delta',
          delta: {},
        }),
      ]);

      const finish = events.find((e) => e.type === 'finish');
      expect(finish).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('emits error event for API error', async () => {
      const events = await transformEvents([
        sse('error', {
          type: 'error',
          error: {
            type: 'overloaded_error',
            message: 'Overloaded',
          },
        }),
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      const errorEvent = events[0] as Extract<StreamEvent, { type: 'error' }>;
      expect(errorEvent.error).toBeInstanceOf(Error);
      expect(errorEvent.error.message).toBe('Overloaded');
    });

    it('uses default message when error message is missing', async () => {
      const events = await transformEvents([
        sse('error', {
          type: 'error',
          error: { type: 'server_error' },
        }),
      ]);

      expect(events).toHaveLength(1);
      const errorEvent = events[0] as Extract<StreamEvent, { type: 'error' }>;
      expect(errorEvent.error.message).toBe('Anthropic API error');
    });

    it('uses default message when error object is missing', async () => {
      const events = await transformEvents([sse('error', { type: 'error' })]);

      expect(events).toHaveLength(1);
      const errorEvent = events[0] as Extract<StreamEvent, { type: 'error' }>;
      expect(errorEvent.error.message).toBe('Anthropic API error');
    });
  });

  describe('malformed JSON', () => {
    it('emits error for invalid JSON in data field', async () => {
      const events = await transformEvents([
        { event: 'content_block_delta', data: '{not valid json' },
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      const errorEvent = events[0] as Extract<StreamEvent, { type: 'error' }>;
      expect(errorEvent.error).toBeInstanceOf(Error);
      expect(errorEvent.error.message).toContain('Failed to parse Anthropic SSE data');
      expect(errorEvent.error.message).toContain('{not valid json');
    });

    it('emits error for empty data field', async () => {
      const events = await transformEvents([{ event: 'message_start', data: '' }]);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
    });

    it('continues processing after a malformed event', async () => {
      const events = await transformEvents([
        { event: 'content_block_delta', data: 'broken!' },
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'recovered' },
        }),
      ]);

      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('error');
      expect(events[1]).toEqual({ type: 'text-delta', text: 'recovered' });
    });
  });

  describe('ping events', () => {
    it('skips ping events and produces no output', async () => {
      const events = await transformEvents([{ event: 'ping', data: '{}' }]);

      expect(events).toHaveLength(0);
    });

    it('skips ping events interspersed with real events', async () => {
      const events = await transformEvents([
        { event: 'ping', data: '{}' },
        sse('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        { event: 'ping', data: '{}' },
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        }),
        { event: 'ping', data: '{}' },
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });

  describe('edge cases', () => {
    it('handles content_block_delta with missing delta gracefully', async () => {
      const events = await transformEvents([
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
        }),
      ]);

      // No delta field means nothing is emitted
      const meaningful = events.filter((e) => e.type !== 'error');
      expect(meaningful).toHaveLength(0);
    });

    it('handles content_block_stop when no block was started', async () => {
      const events = await transformEvents([
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      ]);

      // Should not crash and should not emit tool-call-end
      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(0);
    });

    it('handles message_stop by itself', async () => {
      const events = await transformEvents([sse('message_stop', { type: 'message_stop' })]);

      // message_stop alone produces no output events
      expect(events).toHaveLength(0);
    });

    it('ignores signature_delta in content_block_delta', async () => {
      const events = await transformEvents([
        sse('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'abc123' },
        }),
      ]);

      expect(events).toHaveLength(0);
    });

    it('falls back to data.type when sse.event is undefined', async () => {
      // Some configurations may not include the event field
      const events = await transformEvents([{ data: JSON.stringify({ type: 'message_stop' }) }]);

      expect(events).toHaveLength(0);
    });

    it('falls back to data.type for message_start without event field', async () => {
      const events = await transformEvents([
        {
          data: JSON.stringify({
            type: 'message_start',
            message: {
              id: 'msg_fallback',
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 5, output_tokens: 1 },
            },
          }),
        },
      ]);

      const metadata = events.filter((e) => e.type === 'metadata');
      expect(metadata).toHaveLength(1);
      expect(metadata[0]).toEqual({
        type: 'metadata',
        key: 'model',
        value: 'claude-sonnet-4-20250514',
      });
    });

    it('handles unknown event types without crashing', async () => {
      const events = await transformEvents([
        sse('some_unknown_event', { type: 'some_unknown_event', data: {} }),
      ]);

      // Unknown events are silently ignored (fall through the switch)
      expect(events).toHaveLength(0);
    });
  });
});
