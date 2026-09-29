import { describe, expect, it } from 'vitest';
import { dependencyOrder } from './graph.ts';

const piece = (key: string, dependsOn: string[] = []) => ({ key, dependsOn });

describe('dependencyOrder', () => {
  it('runs dependencies first and breaks ties by key', () => {
    const order = dependencyOrder([
      piece('P3', ['P1']),
      piece('P10'),
      piece('P2', ['P3']),
      piece('P1'),
    ]);
    expect(order.map((p) => p.key)).toEqual(['P1', 'P3', 'P2', 'P10']);
  });

  it('refuses a cycle', () => {
    expect(() => dependencyOrder([piece('A', ['B']), piece('B', ['A'])])).toThrow(/cycle/);
  });
});
