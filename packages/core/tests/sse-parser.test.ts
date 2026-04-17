import { describe, it, expect } from 'vitest';
import { createSSEParser } from '../src/parsers/sse.js';
import type { SSEEvent } from '../src/types.js';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function parseSSE(chunks: string[]): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const parser = createSSEParser();
  const writer = parser.writable.getWriter();
  const reader = parser.readable.getReader();

  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  })();

  for (const chunk of chunks) {
    await writer.write(encode(chunk));
  }
  await writer.close();
  await readAll;

  return events;
}

describe('createSSEParser', () => {
  it('parses basic data-only events', async () => {
    const events = await parseSSE(['data: hello\n\ndata: world\n\n']);
    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe('hello');
    expect(events[1]!.data).toBe('world');
  });

  it('parses events with event type', async () => {
    const events = await parseSSE(['event: message_start\ndata: {"type":"message_start"}\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('message_start');
    expect(events[0]!.data).toBe('{"type":"message_start"}');
  });

  it('handles multi-line data', async () => {
    const events = await parseSSE(['data: line1\ndata: line2\ndata: line3\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('line1\nline2\nline3');
  });

  it('handles data split across chunks', async () => {
    const events = await parseSSE(['data: hel', 'lo\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello');
  });

  it('handles event split across chunks', async () => {
    const events = await parseSSE(['event: mess', 'age\ndata: test\n', '\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('message');
    expect(events[0]!.data).toBe('test');
  });

  it('skips [DONE] sentinel', async () => {
    const events = await parseSSE(['data: hello\n\ndata: [DONE]\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello');
  });

  it('ignores comment lines', async () => {
    const events = await parseSSE([': this is a comment\ndata: hello\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello');
  });

  it('handles BOM at start', async () => {
    const events = await parseSSE(['\uFEFFdata: hello\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello');
  });

  it('parses id field', async () => {
    const events = await parseSSE(['id: 42\ndata: hello\n\n']);
    expect(events[0]!.id).toBe('42');
  });

  it('parses retry field', async () => {
    const events = await parseSSE(['retry: 5000\ndata: hello\n\n']);
    expect(events[0]!.retry).toBe(5000);
  });

  it('handles \\r\\n line endings', async () => {
    const events = await parseSSE(['data: hello\r\n\r\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello');
  });

  it('handles no space after colon', async () => {
    const events = await parseSSE(['data:hello\n\n']);
    expect(events[0]!.data).toBe('hello');
  });

  it('skips empty events (no data lines)', async () => {
    const events = await parseSSE(['\n\ndata: real\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('real');
  });

  it('flushes pending event on stream end', async () => {
    // No trailing double newline
    const events = await parseSSE(['data: hello\n']);
    // flush() should emit the pending event
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello');
  });

  it('handles many rapid small chunks', async () => {
    const chunks = 'data: hello world\n\n'.split('');
    const events = await parseSSE(chunks);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('hello world');
  });

  it('handles JSON data payloads', async () => {
    const json = JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello' } });
    const events = await parseSSE([`data: ${json}\n\n`]);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.data)).toEqual({
      type: 'content_block_delta',
      delta: { text: 'Hello' },
    });
  });
});
