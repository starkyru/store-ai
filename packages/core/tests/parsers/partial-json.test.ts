import { describe, it, expect } from 'vitest';
import { createPartialJSONParser } from '../../src/parsers/partial-json.js';

describe('createPartialJSONParser', () => {
  it('parses complete JSON correctly', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"name": "Alice", "age": 30}');
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('parses incomplete object: missing closing brace', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"name": "Jo');
    expect(result).toEqual({ name: 'Jo' });
  });

  it('parses incomplete array: trailing comma', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('[1, 2, ');
    expect(result).toEqual([1, 2]);
  });

  it('parses incomplete nested structures', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"a": {"b": [');
    expect(result).toEqual({ a: { b: [] } });
  });

  it('handles incomplete string with escape sequence', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"text": "hello \\"wo');
    expect(result).toEqual({ text: 'hello "wo' });
  });

  it('parses incomplete number', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"v": 42');
    expect(result).toEqual({ v: 42 });
  });

  it('handles incomplete boolean gracefully', () => {
    const parser = createPartialJSONParser();
    // "tru" is not valid JSON even repaired to "tru}" so the parser
    // should return null (no valid parse yet)
    const result = parser.push('{"v": tru');
    // The repaired string would be '{"v": tru}' which is invalid JSON.
    // The parser returns the last successful partial, which is null.
    expect(result).toBeNull();
  });

  it('returns null for empty input', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('');
    expect(result).toBeNull();
  });

  it('returns null when input has no structural characters yet', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('   data: ');
    expect(result).toBeNull();
  });

  it('handles trailing comma in objects', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"a": 1, "b": 2, ');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('handles deeply nested objects', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"l1": {"l2": {"l3": {"l4": "de');
    expect(result).toEqual({ l1: { l2: { l3: { l4: 'de' } } } });
  });

  it('reset() clears all state', () => {
    const parser = createPartialJSONParser();
    parser.push('{"a": 1}');
    expect(parser.getPartial()).toEqual({ a: 1 });

    parser.reset();
    expect(parser.getPartial()).toBeNull();
    expect(parser.getFinal()).toBeNull();
  });

  it('getFinal() returns complete parse when JSON is complete', () => {
    const parser = createPartialJSONParser();
    parser.push('{"name": "Alice"}');
    expect(parser.getFinal()).toEqual({ name: 'Alice' });
  });

  it('getFinal() falls back to last partial when JSON is incomplete', () => {
    const parser = createPartialJSONParser();
    parser.push('{"name": "Ali');
    // getFinal tries to parse without repair; that fails,
    // so it returns the lastPartial
    expect(parser.getFinal()).toEqual({ name: 'Ali' });
  });

  it('incremental pushes build up the result', () => {
    const parser = createPartialJSONParser();

    let result = parser.push('{"na');
    // At this point we might get a partial or null
    // '{"na' -> repaired to '{"na"}' which is invalid key syntax
    // Actually: '{"na' -> stack: Object, String -> repair: '{"na"}'
    // That parses as: { na: undefined } - no, JSON.parse('{"na"}') is invalid
    // because it expects a colon after the key. Let's check what actually happens.

    result = parser.push('me": "Al');
    expect(result).toEqual({ name: 'Al' });

    result = parser.push('ice", "age": 3');
    expect(result).toEqual({ name: 'Alice', age: 3 });

    result = parser.push('0}');
    expect(result).toEqual({ name: 'Alice', age: 30 });

    expect(parser.getFinal()).toEqual({ name: 'Alice', age: 30 });
  });

  it('handles array of objects incrementally', () => {
    const parser = createPartialJSONParser();

    parser.push('[{"id": 1}, {"id": 2');
    expect(parser.getPartial()).toEqual([{ id: 1 }, { id: 2 }]);

    parser.push('}, {"id": 3}]');
    expect(parser.getPartial()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('handles string with various escape sequences', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"text": "line1\\nline2\\ttab"}');
    expect(result).toEqual({ text: 'line1\nline2\ttab' });
  });

  it('handles null values', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"v": null}');
    expect(result).toEqual({ v: null });
  });

  it('handles text before the first opening brace', () => {
    const parser = createPartialJSONParser();
    // Some LLMs emit preamble text before the JSON
    const result = parser.push('Here is the result: {"key": "val"}');
    expect(result).toEqual({ key: 'val' });
  });

  it('handles incomplete key-value with trailing colon', () => {
    const parser = createPartialJSONParser();
    const result = parser.push('{"key": ');
    // repaired: '{"key": null}' which parses
    expect(result).toEqual({ key: null });
  });
});
