/**
 * Maximum buffer size (1 MB) to prevent unbounded memory growth from malformed streams.
 * Matches the SSE parser limit.
 */
const MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Creates a TransformStream that parses NDJSON (newline-delimited JSON) streams.
 * Each line is parsed as an independent JSON object.
 *
 * Handles: chunked input, \n and \r\n line endings, empty lines (skipped),
 * UTF-8 multibyte split across chunks, malformed lines (skipped silently).
 *
 * Includes DoS protection: max 1MB buffer, matching SSE parser limits.
 */
export function createNDJSONParser<T = unknown>(): TransformStream<Uint8Array, T> {
  let buffer = '';
  const decoder = new TextDecoder();

  return new TransformStream<Uint8Array, T>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      if (buffer.length > MAX_BUFFER_SIZE) {
        controller.error(
          new Error('NDJSON buffer exceeded maximum size — possible malformed stream'),
        );
        return;
      }

      const lines = buffer.split('\n');
      // Last element may be incomplete — keep it in buffer
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        // Skip empty or whitespace-only lines
        if (line.trim() === '') continue;

        try {
          controller.enqueue(JSON.parse(line) as T);
        } catch {
          // Skip malformed JSON lines — consumers expect valid objects
        }
      }
    },

    flush(controller) {
      // Flush any remaining bytes from the streaming decoder
      buffer += decoder.decode();

      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;

      if (line.trim() !== '') {
        try {
          controller.enqueue(JSON.parse(line) as T);
        } catch {
          // Skip malformed final line
        }
      }
    },
  });
}
