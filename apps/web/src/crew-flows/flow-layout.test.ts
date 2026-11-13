import { describe, expect, it } from 'vitest';
import { FLOW_NODE_WIDTH, layoutFlow } from './flow-layout.ts';

describe('the workflow graph layout', () => {
  it('places each stage to the right of the one before and stacks side-by-side steps', () => {
    const { at, width, height } = layoutFlow({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { source: 'b', target: 'c' },
        { source: 'a', target: 'c' },
      ],
    });
    expect(at.a!.x).toBe(at.b!.x);
    expect(at.a!.y).toBeLessThan(at.b!.y);
    expect(at.c!.x).toBeGreaterThan(at.a!.x + FLOW_NODE_WIDTH);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('ignores edges to steps that are not there or to the step itself', () => {
    const { at } = layoutFlow({
      nodes: [{ id: 'a' }],
      edges: [
        { source: 'gone', target: 'a' },
        { source: 'a', target: 'a' },
      ],
    });
    expect(at).toEqual({ a: { x: 0, y: 0 } });
  });

  it('still places every step when two wait on each other', () => {
    const { at } = layoutFlow({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });
    expect(Object.keys(at)).toEqual(['a', 'b']);
  });
});
