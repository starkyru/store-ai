import { describe, it, expect } from 'vitest';
import { agUI } from '../../src/providers/ag-ui.js';
import type { SSEEvent, StreamEvent } from '../../src/types.js';

async function transformEvents(sseEvents: SSEEvent[]): Promise<StreamEvent[]> {
  const transform = agUI().createTransform();
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

function sse(data: Record<string, unknown>): SSEEvent {
  return { data: JSON.stringify(data) };
}

describe('ag-ui provider', () => {
  it('has the correct name', () => {
    expect(agUI().name).toBe('ag-ui');
  });

  // ── TEXT_MESSAGE_CONTENT ────────────────────────────────────────────

  describe('TEXT_MESSAGE_CONTENT', () => {
    it('emits text-delta for content deltas', async () => {
      const events = await transformEvents([
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: ' world' }),
      ]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'Hello' });
      expect(textDeltas[1]).toEqual({ type: 'text-delta', text: ' world' });
    });

    it('ignores content with empty delta', async () => {
      const events = await transformEvents([sse({ type: 'TEXT_MESSAGE_CONTENT', delta: '' })]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });

    it('ignores content with missing delta', async () => {
      const events = await transformEvents([sse({ type: 'TEXT_MESSAGE_CONTENT' })]);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(0);
    });
  });

  // ── TOOL_CALL_START ────────────────────────────────────────────────

  describe('TOOL_CALL_START', () => {
    it('emits tool-call-start with toolCallId and toolCallName', async () => {
      const events = await transformEvents([
        sse({
          type: 'TOOL_CALL_START',
          toolCallId: 'call_123',
          toolCallName: 'get_weather',
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_123',
        name: 'get_weather',
      });
    });

    it('falls back to id and name fields', async () => {
      const events = await transformEvents([
        sse({
          type: 'TOOL_CALL_START',
          id: 'call_456',
          name: 'search',
        }),
      ]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: 'call_456',
        name: 'search',
      });
    });

    it('defaults to empty strings for missing fields', async () => {
      const events = await transformEvents([sse({ type: 'TOOL_CALL_START' })]);

      const starts = events.filter((e) => e.type === 'tool-call-start');
      expect(starts[0]).toEqual({
        type: 'tool-call-start',
        id: '',
        name: '',
      });
    });
  });

  // ── TOOL_CALL_END ──────────────────────────────────────────────────

  describe('TOOL_CALL_END', () => {
    it('emits tool-call-end with toolCallArgs', async () => {
      const events = await transformEvents([
        sse({
          type: 'TOOL_CALL_END',
          toolCallId: 'call_123',
          toolCallArgs: { city: 'SF' },
        }),
      ]);

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_123',
        input: { city: 'SF' },
      });
    });

    it('falls back to args field', async () => {
      const events = await transformEvents([
        sse({
          type: 'TOOL_CALL_END',
          id: 'call_789',
          args: { query: 'test' },
        }),
      ]);

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_789',
        input: { query: 'test' },
      });
    });

    it('falls back to result field', async () => {
      const events = await transformEvents([
        sse({
          type: 'TOOL_CALL_END',
          toolCallId: 'call_abc',
          result: { data: 42 },
        }),
      ]);

      const ends = events.filter((e) => e.type === 'tool-call-end');
      expect(ends[0]).toEqual({
        type: 'tool-call-end',
        id: 'call_abc',
        input: { data: 42 },
      });
    });
  });

  // ── RUN_STARTED ────────────────────────────────────────────────────

  describe('RUN_STARTED', () => {
    it('emits step-start with runId', async () => {
      const events = await transformEvents([sse({ type: 'RUN_STARTED', runId: 'run_001' })]);

      const starts = events.filter((e) => e.type === 'step-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({ type: 'step-start', stepId: 'run_001' });
    });

    it('defaults stepId to "run" when runId is missing', async () => {
      const events = await transformEvents([sse({ type: 'RUN_STARTED' })]);

      const starts = events.filter((e) => e.type === 'step-start');
      expect(starts[0]).toEqual({ type: 'step-start', stepId: 'run' });
    });
  });

  // ── RUN_FINISHED ───────────────────────────────────────────────────

  describe('RUN_FINISHED', () => {
    it('emits finish with stop reason', async () => {
      const events = await transformEvents([sse({ type: 'RUN_FINISHED' })]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── RUN_ERROR ──────────────────────────────────────────────────────

  describe('RUN_ERROR', () => {
    it('emits error with message field', async () => {
      const events = await transformEvents([
        sse({ type: 'RUN_ERROR', message: 'Rate limit exceeded' }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'Rate limit exceeded',
      );
    });

    it('falls back to error field', async () => {
      const events = await transformEvents([
        sse({ type: 'RUN_ERROR', error: 'Something went wrong' }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe(
        'Something went wrong',
      );
    });

    it('uses default message when both are missing', async () => {
      const events = await transformEvents([sse({ type: 'RUN_ERROR' })]);

      const errors = events.filter((e) => e.type === 'error');
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toBe('AG-UI run error');
    });
  });

  // ── STEP_STARTED / STEP_FINISHED ───────────────────────────────────

  describe('STEP_STARTED', () => {
    it('emits step-start with stepId', async () => {
      const events = await transformEvents([sse({ type: 'STEP_STARTED', stepId: 'step_1' })]);

      const starts = events.filter((e) => e.type === 'step-start');
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({ type: 'step-start', stepId: 'step_1' });
    });

    it('defaults stepId to empty string', async () => {
      const events = await transformEvents([sse({ type: 'STEP_STARTED' })]);

      const starts = events.filter((e) => e.type === 'step-start');
      expect(starts[0]).toEqual({ type: 'step-start', stepId: '' });
    });
  });

  describe('STEP_FINISHED', () => {
    it('emits step-end with stepId', async () => {
      const events = await transformEvents([sse({ type: 'STEP_FINISHED', stepId: 'step_1' })]);

      const ends = events.filter((e) => e.type === 'step-end');
      expect(ends).toHaveLength(1);
      expect(ends[0]).toEqual({ type: 'step-end', stepId: 'step_1' });
    });

    it('defaults stepId to empty string', async () => {
      const events = await transformEvents([sse({ type: 'STEP_FINISHED' })]);

      const ends = events.filter((e) => e.type === 'step-end');
      expect(ends[0]).toEqual({ type: 'step-end', stepId: '' });
    });
  });

  // ── Metadata events ────────────────────────────────────────────────

  describe('STATE_DELTA', () => {
    it('emits metadata with state_delta key', async () => {
      const events = await transformEvents([sse({ type: 'STATE_DELTA', delta: { count: 5 } })]);

      const metas = events.filter((e) => e.type === 'metadata');
      expect(metas).toHaveLength(1);
      expect(metas[0]).toEqual({
        type: 'metadata',
        key: 'state_delta',
        value: { type: 'STATE_DELTA', delta: { count: 5 } },
      });
    });
  });

  describe('STATE_SNAPSHOT', () => {
    it('emits metadata with state_snapshot key', async () => {
      const events = await transformEvents([
        sse({ type: 'STATE_SNAPSHOT', snapshot: { items: [1, 2] } }),
      ]);

      const metas = events.filter((e) => e.type === 'metadata');
      expect(metas).toHaveLength(1);
      expect(metas[0]).toEqual({
        type: 'metadata',
        key: 'state_snapshot',
        value: { type: 'STATE_SNAPSHOT', snapshot: { items: [1, 2] } },
      });
    });
  });

  describe('MESSAGES_SNAPSHOT', () => {
    it('emits metadata with messages_snapshot key', async () => {
      const events = await transformEvents([
        sse({ type: 'MESSAGES_SNAPSHOT', messages: [{ role: 'user', content: 'hi' }] }),
      ]);

      const metas = events.filter((e) => e.type === 'metadata');
      expect(metas).toHaveLength(1);
      expect((metas[0] as any).key).toBe('messages_snapshot');
    });
  });

  describe('CUSTOM', () => {
    it('emits metadata with custom key', async () => {
      const events = await transformEvents([
        sse({ type: 'CUSTOM', payload: { action: 'highlight' } }),
      ]);

      const metas = events.filter((e) => e.type === 'metadata');
      expect(metas).toHaveLength(1);
      expect(metas[0]).toEqual({
        type: 'metadata',
        key: 'custom',
        value: { type: 'CUSTOM', payload: { action: 'highlight' } },
      });
    });
  });

  describe('RAW', () => {
    it('emits metadata with raw key', async () => {
      const events = await transformEvents([sse({ type: 'RAW', data: 'binary-stuff' })]);

      const metas = events.filter((e) => e.type === 'metadata');
      expect(metas).toHaveLength(1);
      expect((metas[0] as any).key).toBe('raw');
    });
  });

  // ── Unknown event types ────────────────────────────────────────────

  describe('unknown event types', () => {
    it('silently ignores unrecognized event types', async () => {
      const events = await transformEvents([
        sse({ type: 'UNKNOWN_TYPE', data: 'foo' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'hello' }),
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });

    it('ignores TEXT_MESSAGE_START structural events', async () => {
      const events = await transformEvents([
        sse({ type: 'TEXT_MESSAGE_START', messageId: 'msg_1' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'content' }),
        sse({ type: 'TEXT_MESSAGE_END', messageId: 'msg_1' }),
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'content' });
    });

    it('ignores events with no type field', async () => {
      const events = await transformEvents([
        sse({ data: 'something' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'hello' }),
      ]);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });

  // ── Event type from SSE event field ────────────────────────────────

  describe('event type fallback to sse.event', () => {
    it('uses sse.event when data.type is missing', async () => {
      const events = await transformEvents([{ event: 'RUN_FINISHED', data: JSON.stringify({}) }]);

      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });
    });
  });

  // ── Malformed JSON ─────────────────────────────────────────────────

  describe('malformed JSON', () => {
    it('emits an error event for invalid JSON', async () => {
      const events = await transformEvents([{ data: '{invalid json}}}' }]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);
      expect((errors[0] as { type: 'error'; error: Error }).error).toBeInstanceOf(Error);
      expect((errors[0] as { type: 'error'; error: Error }).error.message).toContain(
        'Failed to parse AG-UI event',
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
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'hello' }),
      ]);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(1);

      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(1);
      expect(textDeltas[0]).toEqual({ type: 'text-delta', text: 'hello' });
    });
  });

  // ── Full realistic stream ──────────────────────────────────────────

  describe('full realistic AG-UI stream', () => {
    it('processes a complete agent conversation end-to-end', async () => {
      const events = await transformEvents([
        sse({ type: 'RUN_STARTED', runId: 'run_42' }),
        sse({ type: 'STEP_STARTED', stepId: 'step_1' }),
        sse({ type: 'TEXT_MESSAGE_START', messageId: 'msg_1' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Let me ' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'look that up.' }),
        sse({ type: 'TEXT_MESSAGE_END', messageId: 'msg_1' }),
        sse({
          type: 'TOOL_CALL_START',
          toolCallId: 'tc_1',
          toolCallName: 'search',
        }),
        sse({
          type: 'TOOL_CALL_END',
          toolCallId: 'tc_1',
          toolCallArgs: { query: 'weather SF' },
        }),
        sse({ type: 'STEP_FINISHED', stepId: 'step_1' }),
        sse({ type: 'STEP_STARTED', stepId: 'step_2' }),
        sse({
          type: 'STATE_DELTA',
          delta: { searchResults: ['sunny'] },
        }),
        sse({ type: 'TEXT_MESSAGE_START', messageId: 'msg_2' }),
        sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'It is sunny in SF.' }),
        sse({ type: 'TEXT_MESSAGE_END', messageId: 'msg_2' }),
        sse({ type: 'STEP_FINISHED', stepId: 'step_2' }),
        sse({ type: 'RUN_FINISHED' }),
      ]);

      // Run started -> step-start
      const stepStarts = events.filter((e) => e.type === 'step-start');
      expect(stepStarts).toHaveLength(3); // run + step_1 + step_2
      expect(stepStarts[0]).toEqual({ type: 'step-start', stepId: 'run_42' });
      expect(stepStarts[1]).toEqual({ type: 'step-start', stepId: 'step_1' });
      expect(stepStarts[2]).toEqual({ type: 'step-start', stepId: 'step_2' });

      // Text deltas
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas).toHaveLength(3);
      const fullText = textDeltas.map((e) => (e as { text: string }).text).join('');
      expect(fullText).toBe('Let me look that up.It is sunny in SF.');

      // Tool call lifecycle
      const toolStarts = events.filter((e) => e.type === 'tool-call-start');
      expect(toolStarts).toHaveLength(1);
      expect((toolStarts[0] as any).name).toBe('search');

      const toolEnds = events.filter((e) => e.type === 'tool-call-end');
      expect(toolEnds).toHaveLength(1);
      expect(toolEnds[0]).toEqual({
        type: 'tool-call-end',
        id: 'tc_1',
        input: { query: 'weather SF' },
      });

      // Step ends
      const stepEnds = events.filter((e) => e.type === 'step-end');
      expect(stepEnds).toHaveLength(2);
      expect(stepEnds[0]).toEqual({ type: 'step-end', stepId: 'step_1' });
      expect(stepEnds[1]).toEqual({ type: 'step-end', stepId: 'step_2' });

      // State delta metadata
      const metas = events.filter((e) => e.type === 'metadata');
      expect(metas).toHaveLength(1);
      expect((metas[0] as any).key).toBe('state_delta');

      // Finish
      const finishes = events.filter((e) => e.type === 'finish');
      expect(finishes).toHaveLength(1);
      expect(finishes[0]).toEqual({ type: 'finish', reason: 'stop' });

      // TEXT_MESSAGE_START / TEXT_MESSAGE_END should be silently ignored
      const allTypes = events.map((e) => e.type);
      expect(allTypes).not.toContain('TEXT_MESSAGE_START');
      expect(allTypes).not.toContain('TEXT_MESSAGE_END');
    });
  });

  // ── State isolation ────────────────────────────────────────────────

  describe('state isolation', () => {
    it('each createTransform() call produces independent streams', async () => {
      const adapter = agUI();

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

      await writer1.write(sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'stream1' }));
      await writer1.close();
      await read1;

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

      await writer2.write(sse({ type: 'TEXT_MESSAGE_CONTENT', delta: 'stream2' }));
      await writer2.close();
      await read2;

      expect(events1).toHaveLength(1);
      expect(events1[0]).toEqual({ type: 'text-delta', text: 'stream1' });
      expect(events2).toHaveLength(1);
      expect(events2[0]).toEqual({ type: 'text-delta', text: 'stream2' });
    });
  });
});
