import { describe, it, expect } from 'vitest';
import { aiReducer, getInitialState } from '../src/reducer.js';
import type { AIState, StoreAction } from '../src/types.js';

describe('aiReducer', () => {
  describe('initial state', () => {
    it('returns correct initial state', () => {
      const state = getInitialState();
      expect(state.status).toBe('idle');
      expect(state.text).toBe('');
      expect(state.thinking).toBe('');
      expect(state.messages).toEqual([]);
      expect(state.toolCalls).toEqual([]);
      expect(state.error).toBeNull();
      expect(state.usage).toBeNull();
      expect(state.latency).toBeNull();
      expect(state.partialObject).toBeNull();
      expect(state.object).toBeNull();
    });
  });

  describe('stream/start', () => {
    it('transitions to streaming status', () => {
      const state = getInitialState();
      const next = aiReducer(state, { type: 'stream/start' });
      expect(next.status).toBe('streaming');
      expect(next.error).toBeNull();
      expect(next.latency).not.toBeNull();
      expect(next.latency!.startMs).toBeGreaterThan(0);
    });

    it('clears previous text and tool calls', () => {
      let state = getInitialState();
      state = {
        ...state,
        text: 'old text',
        thinking: 'old thinking',
        toolCalls: [{ id: '1' } as any],
      };
      const next = aiReducer(state, { type: 'stream/start' });
      expect(next.text).toBe('');
      expect(next.thinking).toBe('');
      expect(next.toolCalls).toEqual([]);
    });

    it('preserves model from meta', () => {
      const state = getInitialState();
      const next = aiReducer(state, {
        type: 'stream/start',
        meta: { model: 'claude-3', provider: 'anthropic' },
      });
      expect(next.model).toBe('claude-3');
      expect(next.provider).toBe('anthropic');
    });
  });

  describe('stream/text-delta', () => {
    it('accumulates text', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/text-delta', delta: 'Hello' });
      expect(state.text).toBe('Hello');
      expect(state.textDelta).toBe('Hello');

      state = aiReducer(state, { type: 'stream/text-delta', delta: ' world' });
      expect(state.text).toBe('Hello world');
      expect(state.textDelta).toBe(' world');
    });

    it('records time to first token', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/text-delta', delta: 'a' });
      expect(state.latency!.firstTokenMs).not.toBeNull();
      expect(state.latency!.ttft).not.toBeNull();
      expect(state.latency!.ttft!).toBeGreaterThanOrEqual(0);
    });
  });

  describe('stream/thinking-delta', () => {
    it('accumulates thinking tokens', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/thinking-delta', delta: 'Let me think' });
      expect(state.thinking).toBe('Let me think');
      expect(state.thinkingDelta).toBe('Let me think');

      state = aiReducer(state, { type: 'stream/thinking-delta', delta: '...' });
      expect(state.thinking).toBe('Let me think...');
      expect(state.thinkingDelta).toBe('...');
    });
  });

  describe('tool calls', () => {
    it('tracks tool call lifecycle', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });

      // Start
      state = aiReducer(state, { type: 'stream/tool-call-start', id: 'tc1', name: 'get_weather' });
      expect(state.toolCalls).toHaveLength(1);
      expect(state.toolCalls[0]!.status).toBe('pending');
      expect(state.toolCalls[0]!.name).toBe('get_weather');

      // Delta
      state = aiReducer(state, {
        type: 'stream/tool-call-delta',
        toolCallId: 'tc1',
        inputDelta: '{"city":',
      });
      expect(state.toolCalls[0]!.status).toBe('partial');
      expect(state.toolCalls[0]!.inputText).toBe('{"city":');

      state = aiReducer(state, {
        type: 'stream/tool-call-delta',
        toolCallId: 'tc1',
        inputDelta: '"SF"}',
      });
      expect(state.toolCalls[0]!.inputText).toBe('{"city":"SF"}');

      // Complete
      state = aiReducer(state, {
        type: 'stream/tool-call-complete',
        toolCallId: 'tc1',
        input: { city: 'SF' },
      });
      expect(state.toolCalls[0]!.status).toBe('complete');
      expect(state.toolCalls[0]!.input).toEqual({ city: 'SF' });
      expect(state.toolCalls[0]!.completedAt).not.toBeNull();
    });

    it('handles tool result', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/tool-call-start', id: 'tc1', name: 'get_weather' });
      state = aiReducer(state, { type: 'stream/tool-call-complete', toolCallId: 'tc1', input: {} });
      state = aiReducer(state, { type: 'tool/result', toolCallId: 'tc1', result: { temp: 72 } });
      expect(state.toolCalls[0]!.output).toEqual({ temp: 72 });
    });
  });

  describe('stream/complete', () => {
    it('transitions to complete and builds assistant message', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/text-delta', delta: 'Hello world' });
      state = aiReducer(state, { type: 'stream/complete' });

      expect(state.status).toBe('complete');
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]!.role).toBe('assistant');
      expect(state.messages[0]!.content).toContainEqual({ type: 'text', text: 'Hello world' });
      expect(state.lastMessage).toBe(state.messages[0]);
      expect(state.latency!.endMs).not.toBeNull();
      expect(state.latency!.totalMs).not.toBeNull();
    });

    it('includes usage if provided', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      const usage = { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, totalTokens: 30 };
      state = aiReducer(state, { type: 'stream/complete', usage });
      expect(state.usage).toEqual(usage);
    });
  });

  describe('stream/error', () => {
    it('transitions to error status', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      const error = new Error('API rate limit');
      state = aiReducer(state, { type: 'stream/error', error });
      expect(state.status).toBe('error');
      expect(state.error).toBe(error);
    });
  });

  describe('stream/abort', () => {
    it('transitions to aborted, preserves accumulated text', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/text-delta', delta: 'partial' });
      state = aiReducer(state, { type: 'stream/abort' });
      expect(state.status).toBe('aborted');
      expect(state.text).toBe('partial');
    });
  });

  describe('messages', () => {
    it('sets messages', () => {
      const messages = [
        {
          id: '1',
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'hi' }],
          createdAt: new Date(),
        },
      ];
      const state = aiReducer(getInitialState(), { type: 'messages/set', messages });
      expect(state.messages).toEqual(messages);
      expect(state.lastMessage).toBe(messages[0]);
    });

    it('appends message', () => {
      const msg = {
        id: '1',
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hi' }],
        createdAt: new Date(),
      };
      const state = aiReducer(getInitialState(), { type: 'messages/append', message: msg });
      expect(state.messages).toHaveLength(1);
      expect(state.lastMessage).toBe(msg);
    });
  });

  describe('reset', () => {
    it('returns to initial state', () => {
      let state = aiReducer(getInitialState(), { type: 'stream/start' });
      state = aiReducer(state, { type: 'stream/text-delta', delta: 'data' });
      state = aiReducer(state, { type: 'reset' });
      expect(state).toEqual(getInitialState());
    });
  });

  describe('unknown action', () => {
    it('returns state unchanged', () => {
      const state = getInitialState();
      const next = aiReducer(state, { type: 'unknown' } as any);
      expect(next).toBe(state);
    });
  });
});
