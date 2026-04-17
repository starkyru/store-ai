import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { resolve } from 'path';

describe('bundle size', () => {
  it('core ESM bundle is under 20KB gzipped', () => {
    const bundle = readFileSync(resolve(__dirname, '../dist/index.js'));
    const gzipped = gzipSync(bundle);
    console.log(`Core ESM: ${bundle.length}B raw, ${gzipped.length}B gzipped`);
    expect(gzipped.length).toBeLessThan(20 * 1024);
  });

  it('core CJS bundle is under 20KB gzipped', () => {
    const bundle = readFileSync(resolve(__dirname, '../dist/index.cjs'));
    const gzipped = gzipSync(bundle);
    console.log(`Core CJS: ${bundle.length}B raw, ${gzipped.length}B gzipped`);
    expect(gzipped.length).toBeLessThan(20 * 1024);
  });
});
