import { describe, it, expect } from 'vitest';
import * as vueExports from '../src/index.js';

describe('@store-ai/vue', () => {
  describe('module exports', () => {
    it('exports useAI as a function', () => {
      expect(typeof vueExports.useAI).toBe('function');
    });

    it('exports exactly 1 composable function', () => {
      const fnExports = Object.entries(vueExports).filter(
        ([_, value]) => typeof value === 'function',
      );
      expect(fnExports).toHaveLength(1);
      expect(fnExports[0]![0]).toBe('useAI');
    });
  });
});
