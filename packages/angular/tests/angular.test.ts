import { describe, it, expect } from 'vitest';
import * as angularExports from '../src/index.js';

describe('@store-ai/angular', () => {
  describe('module exports', () => {
    it('exports useAI as a function', () => {
      expect(typeof angularExports.useAI).toBe('function');
    });

    it('exports toObservable as a function', () => {
      expect(typeof angularExports.toObservable).toBe('function');
    });

    it('exports exactly 2 functions', () => {
      const exportNames = Object.keys(angularExports).filter(
        (k) => typeof (angularExports as Record<string, unknown>)[k] === 'function',
      );
      expect(exportNames).toHaveLength(2);
      expect(exportNames).toEqual(['useAI', 'toObservable']);
    });
  });
});
