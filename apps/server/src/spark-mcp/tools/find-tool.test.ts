import { describe, expect, it } from 'vitest';
import { findTool } from './find-tool.ts';

describe('spark_find input', () => {
  const context = { deps: {}, scope: {} } as never;

  it('refuses folders outside the project and empty queries', () => {
    const run = (args: unknown) => () => findTool.run(args, context);
    expect(run({ query: 'route', under: '../other' })).toThrow(/inside the project/);
    expect(run({ query: 'route', under: '/etc' })).toThrow(/inside the project/);
    expect(run({ query: ' ' })).toThrow();
    expect(run({ query: 'route', limit: 500 })).toThrow();
  });

  it('is a read tool', () => {
    expect(findTool.acts).toBeUndefined();
  });
});
