import { describe, it, expect } from 'vitest';
import { createNDJSONParser } from '../../src/parsers/ndjson.js';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function parseNDJSON<T = unknown>(chunks: (string | Uint8Array)[]): Promise<T[]> {
  const results: T[] = [];
  const parser = createNDJSONParser<T>();
  const writer = parser.writable.getWriter();
  const reader = parser.readable.getReader();

  const readAll = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value);
    }
  })();

  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      await writer.write(encode(chunk));
    } else {
      await writer.write(chunk);
    }
  }
  await writer.close();
  await readAll;

  return results;
}

describe('createNDJSONParser', () => {
  it('parses basic NDJSON (one object per line)', async () => {
    const results = await parseNDJSON(['{"a":1}\n{"b":2}\n{"c":3}\n']);
    expect(results).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('handles chunked input (split across multiple writes)', async () => {
    const results = await parseNDJSON(['{"hel', 'lo":"wor', 'ld"}\n']);
    expect(results).toEqual([{ hello: 'world' }]);
  });

  it('handles \\r\\n line endings', async () => {
    const results = await parseNDJSON(['{"a":1}\r\n{"b":2}\r\n']);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips empty lines', async () => {
    const results = await parseNDJSON(['{"a":1}\n\n\n{"b":2}\n']);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips whitespace-only lines', async () => {
    const results = await parseNDJSON(['{"a":1}\n   \n\t\n{"b":2}\n']);
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips malformed JSON lines and continues parsing', async () => {
    const results = await parseNDJSON(['{"valid":1}\nnot json\n{"also_valid":2}\n']);
    expect(results).toEqual([{ valid: 1 }, { also_valid: 2 }]);
  });

  it('handles UTF-8 multibyte characters split across chunks', async () => {
    // U+1F600 (grinning face) is 4 bytes in UTF-8: F0 9F 98 80
    const full = '{"emoji":"\u{1F600}"}\n';
    const bytes = new TextEncoder().encode(full);

    // Split in the middle of the emoji (after first 2 bytes of the 4-byte char)
    // The emoji starts after {"emoji":" which is 11 bytes
    const splitPoint = 12; // In the middle of the 4-byte emoji
    const chunk1 = bytes.slice(0, splitPoint);
    const chunk2 = bytes.slice(splitPoint);

    const results = await parseNDJSON<{ emoji: string }>([chunk1, chunk2]);
    expect(results).toEqual([{ emoji: '\u{1F600}' }]);
  });

  it('flushes remaining buffer on stream end', async () => {
    // No trailing newline
    const results = await parseNDJSON(['{"flushed":true}']);
    expect(results).toEqual([{ flushed: true }]);
  });

  it('errors when buffer exceeds 1MB (DoS protection)', async () => {
    const parser = createNDJSONParser();
    const writer = parser.writable.getWriter();
    const reader = parser.readable.getReader();

    // Write a chunk that exceeds 1MB without any newline
    const hugeChunk = 'x'.repeat(1024 * 1024 + 1);

    let caughtError: Error | null = null;
    const readAll = (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch (err) {
        caughtError = err as Error;
      }
    })();

    try {
      await writer.write(encode(hugeChunk));
    } catch {
      // Writer may throw after controller.error
    }

    try {
      await writer.close();
    } catch {
      // Expected to fail after error
    }
    await readAll;

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toContain('NDJSON buffer exceeded maximum size');
  });

  it('handles many rapid small chunks (single char at a time)', async () => {
    const input = '{"key":"value"}\n';
    const chunks = input.split('');
    const results = await parseNDJSON(chunks);
    expect(results).toEqual([{ key: 'value' }]);
  });

  it('handles nested JSON objects', async () => {
    const nested = { outer: { inner: { deep: [1, 2, 3] } }, flag: true };
    const results = await parseNDJSON([JSON.stringify(nested) + '\n']);
    expect(results).toEqual([nested]);
  });

  it('handles JSON arrays as line values', async () => {
    const results = await parseNDJSON(['[1,2,3]\n["a","b"]\n']);
    expect(results).toEqual([
      [1, 2, 3],
      ['a', 'b'],
    ]);
  });

  it('handles mixed valid and invalid lines with \\r\\n endings', async () => {
    const results = await parseNDJSON(['{"ok":1}\r\nbroken\r\n{"ok":2}\r\n']);
    expect(results).toEqual([{ ok: 1 }, { ok: 2 }]);
  });
});
