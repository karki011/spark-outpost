import { describe, expect, it } from 'vitest';
import { MAP_LOCATE_MAX_PATHS, mapLocateQuerySchema } from './map.ts';

describe('mapLocateQuerySchema', () => {
  it('accepts one path or several', () => {
    expect(mapLocateQuerySchema.parse({ path: 'a.ts' }).path).toEqual(['a.ts']);
    expect(mapLocateQuerySchema.parse({ path: ['a.ts', 'b.ts'] }).path).toEqual(['a.ts', 'b.ts']);
  });

  it('rejects no path, an empty path, a long path and too many paths', () => {
    expect(mapLocateQuerySchema.safeParse({}).success).toBe(false);
    expect(mapLocateQuerySchema.safeParse({ path: '' }).success).toBe(false);
    expect(mapLocateQuerySchema.safeParse({ path: 'a'.repeat(1025) }).success).toBe(false);
    const many = Array.from({ length: MAP_LOCATE_MAX_PATHS + 1 }, (_, i) => `f${i}.ts`);
    expect(mapLocateQuerySchema.safeParse({ path: many }).success).toBe(false);
  });
});
