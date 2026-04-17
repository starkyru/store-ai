import type { SSEEvent } from '../types.js';

/** Maximum buffer size (1 MB) to prevent unbounded memory growth from malformed streams. */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Maximum number of data lines per SSE event to prevent memory exhaustion. */
const MAX_DATA_LINES = 10_000;

/**
 * Creates a TransformStream that parses raw bytes into SSE events.
 *
 * Handles:
 * - Multi-line `data:` fields (joined with newlines)
 * - `event:`, `id:`, `retry:` fields
 * - BOM stripping
 * - Empty lines as event delimiters
 * - `[DONE]` sentinel (skipped, does not emit)
 */
export function createSSEParser(): TransformStream<Uint8Array, SSEEvent> {
  let buffer = '';
  let event: Partial<SSEEvent> = {};
  let dataLines: string[] = [];
  const decoder = new TextDecoder();

  return new TransformStream<Uint8Array, SSEEvent>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      if (buffer.length > MAX_BUFFER_SIZE) {
        controller.error(new Error('SSE buffer exceeded maximum size — possible malformed stream'));
        return;
      }

      // Strip BOM if present at start
      if (buffer.startsWith('\uFEFF')) {
        buffer = buffer.slice(1);
      }

      const lines = buffer.split('\n');
      // Last element may be incomplete — keep it in buffer
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        if (line === '') {
          // Empty line = dispatch event
          if (dataLines.length > 0) {
            const data = dataLines.join('\n');

            // Skip [DONE] sentinel
            if (data !== '[DONE]') {
              controller.enqueue({
                ...event,
                data,
              } as SSEEvent);
            }
          }
          // Reset for next event
          event = {};
          dataLines = [];
          continue;
        }

        // Comment lines (start with ':')
        if (line.startsWith(':')) {
          continue;
        }

        const colonIdx = line.indexOf(':');
        let field: string;
        let value: string;

        if (colonIdx === -1) {
          field = line;
          value = '';
        } else {
          field = line.slice(0, colonIdx);
          // Skip single leading space after colon
          value = line[colonIdx + 1] === ' ' ? line.slice(colonIdx + 2) : line.slice(colonIdx + 1);
        }

        switch (field) {
          case 'data':
            if (dataLines.length >= MAX_DATA_LINES) {
              controller.error(
                new Error('SSE event exceeded maximum data line count — possible malformed stream'),
              );
              return;
            }
            dataLines.push(value);
            break;
          case 'event':
            event.event = value;
            break;
          case 'id':
            event.id = value;
            break;
          case 'retry': {
            const retry = parseInt(value, 10);
            if (!Number.isNaN(retry)) {
              event.retry = retry;
            }
            break;
          }
          // Unknown fields are ignored per SSE spec
        }
      }
    },

    flush(controller) {
      // Flush remaining buffer
      buffer += decoder.decode();

      // If there's a pending event, dispatch it
      if (dataLines.length > 0) {
        const data = dataLines.join('\n');
        if (data !== '[DONE]') {
          controller.enqueue({
            ...event,
            data,
          } as SSEEvent);
        }
      }
    },
  });
}
