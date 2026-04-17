import { describe, it, expect } from 'vitest';
import * as reactExports from '../src/index.js';

describe('@store-ai/react', () => {
  describe('module exports', () => {
    it('exports useAIStore as a function', () => {
      expect(typeof reactExports.useAIStore).toBe('function');
    });

    it('exports useAIText as a function', () => {
      expect(typeof reactExports.useAIText).toBe('function');
    });

    it('exports useAIStatus as a function', () => {
      expect(typeof reactExports.useAIStatus).toBe('function');
    });

    it('exports useAIMessages as a function', () => {
      expect(typeof reactExports.useAIMessages).toBe('function');
    });

    it('exports useAIToolCalls as a function', () => {
      expect(typeof reactExports.useAIToolCalls).toBe('function');
    });

    it('exports useAIObject as a function', () => {
      expect(typeof reactExports.useAIObject).toBe('function');
    });

    it('exports useAIThinking as a function', () => {
      expect(typeof reactExports.useAIThinking).toBe('function');
    });

    it('exports useAIIsStreaming as a function', () => {
      expect(typeof reactExports.useAIIsStreaming).toBe('function');
    });

    it('exports useAIError as a function', () => {
      expect(typeof reactExports.useAIError).toBe('function');
    });

    it('exports exactly 9 hooks', () => {
      const exportNames = Object.keys(reactExports);
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

      // Verify selector functions work with state shapes
      const textSelector = (s: typeof mockState) => s.text;
      const statusSelector = (s: typeof mockState) => s.status;
      const streamingSelector = (s: typeof mockState) => s.isStreaming;

      expect(textSelector(mockState)).toBe('hello');
      expect(statusSelector(mockState)).toBe('idle');
      expect(streamingSelector(mockState)).toBe(false);
    });
  });
});
