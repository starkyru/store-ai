import { describe, it, expect } from 'vitest';
import * as preactExports from '../src/index.js';

describe('@store-ai/preact', () => {
  describe('module exports', () => {
    it('exports useAIStore as a function', () => {
      expect(typeof preactExports.useAIStore).toBe('function');
    });

    it('exports useAIText as a function', () => {
      expect(typeof preactExports.useAIText).toBe('function');
    });

    it('exports useAIStatus as a function', () => {
      expect(typeof preactExports.useAIStatus).toBe('function');
    });

    it('exports useAIMessages as a function', () => {
      expect(typeof preactExports.useAIMessages).toBe('function');
    });

    it('exports useAIToolCalls as a function', () => {
      expect(typeof preactExports.useAIToolCalls).toBe('function');
    });

    it('exports useAIObject as a function', () => {
      expect(typeof preactExports.useAIObject).toBe('function');
    });

    it('exports useAIThinking as a function', () => {
      expect(typeof preactExports.useAIThinking).toBe('function');
    });

    it('exports useAIIsStreaming as a function', () => {
      expect(typeof preactExports.useAIIsStreaming).toBe('function');
    });

    it('exports useAIError as a function', () => {
      expect(typeof preactExports.useAIError).toBe('function');
    });

    it('exports exactly 9 hooks', () => {
      const exportNames = Object.keys(preactExports);
      expect(exportNames).toHaveLength(9);
      expect(exportNames).toEqual([
        'useAIStore',
        'useAIText',
        'useAIStatus',
        'useAIMessages',
        'useAIToolCalls',
        'useAIObject',
        'useAIThinking',
        'useAIIsStreaming',
        'useAIError',
      ]);
    });
  });

  describe('selector pattern', () => {
    it('selector extracts the correct field from a state-like object', () => {
      const mockState = {
        text: 'hello',
        status: 'idle' as const,
        messages: [],
        toolCalls: [],
        thinking: '',
        error: null,
        isStreaming: false,
        partialObject: null,
      };

      const textSelector = (s: typeof mockState) => s.text;
      const statusSelector = (s: typeof mockState) => s.status;
      const streamingSelector = (s: typeof mockState) => s.isStreaming;

      expect(textSelector(mockState)).toBe('hello');
      expect(statusSelector(mockState)).toBe('idle');
      expect(streamingSelector(mockState)).toBe(false);
    });
  });
});
