import { describe, expect, it, vi } from 'vitest';
import {
  latestOnly,
  parentElementOf,
  stepGesture,
  type GestureState,
  type PickPointer,
} from './pick-gesture.ts';

const pointer = (type: PickPointer['type'], x: number, y: number, shift = false): PickPointer => ({
  type,
  x,
  y,
  shift,
});

function run(mode: 'element' | 'region', pointers: PickPointer[]) {
  let state: GestureState | null = null;
  return pointers.map((next) => {
    const step = stepGesture(state, mode, next);
    state = step.state;
    return step.action;
  });
}

describe('stepGesture', () => {
  it('hovers on a move with no button down in element mode, and not in region mode', () => {
    expect(run('element', [pointer('move', 5, 6)])).toEqual([{ kind: 'hover', x: 5, y: 6 }]);
    expect(run('region', [pointer('move', 5, 6)])).toEqual([{ kind: 'none' }]);
  });

  it('treats a press and release with a small slip as a click', () => {
    const actions = run('element', [
      pointer('down', 10, 10),
      pointer('move', 12, 12),
      pointer('up', 12, 12),
    ]);
    expect(actions.at(-1)).toEqual({ kind: 'click', x: 12, y: 12, keep: false });
  });

  it('keeps selecting after a shift click', () => {
    const actions = run('element', [pointer('down', 1, 1), pointer('up', 1, 1, true)]);
    expect(actions.at(-1)).toMatchObject({ kind: 'click', keep: true });
  });

  it('turns a drag into a region in either mode, dragged in any direction', () => {
    for (const mode of ['element', 'region'] as const) {
      const actions = run(mode, [
        pointer('down', 50, 50),
        pointer('move', 20, 30),
        pointer('up', 10, 15),
      ]);
      expect(actions[1]).toEqual({ kind: 'band', box: { x: 20, y: 30, width: 30, height: 20 } });
      expect(actions[2]).toEqual({
        kind: 'region',
        box: { x: 10, y: 15, width: 40, height: 35 },
        keep: false,
      });
    }
  });

  it('ignores a click in region mode and a release with no press', () => {
    expect(run('region', [pointer('down', 1, 1), pointer('up', 1, 1)]).at(-1)).toEqual({
      kind: 'none',
    });
    expect(run('element', [pointer('up', 1, 1)])).toEqual([{ kind: 'none' }]);
  });
});

describe('parentElementOf', () => {
  const tree = {
    backendNodeId: 1,
    nodeName: '#document',
    children: [
      {
        backendNodeId: 2,
        nodeName: 'HTML',
        children: [
          {
            backendNodeId: 3,
            nodeName: 'DIV',
            shadowRoots: [
              {
                backendNodeId: 4,
                nodeName: '#document-fragment',
                children: [{ backendNodeId: 5, nodeName: 'BUTTON' }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('finds the nearest element, crossing a shadow root', () => {
    expect(parentElementOf(tree, 5)).toBe(3);
    expect(parentElementOf(tree, 3)).toBe(2);
  });

  it('has no parent at the top or for a node that left the page', () => {
    expect(parentElementOf(tree, 2)).toBeNull();
    expect(parentElementOf(tree, 99)).toBeNull();
  });
});

describe('latestOnly', () => {
  it('runs the first and last of a burst, in order', async () => {
    const seen: number[] = [];
    const gates: (() => void)[] = [];
    const run = latestOnly(async (value: number) => {
      seen.push(value);
      await new Promise<void>((resolve) => gates.push(resolve));
    });
    run(1);
    run(2);
    run(3);
    gates[0]!();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]!();
    expect(seen).toEqual([1, 3]);
  });

  it('keeps going after a failed run', async () => {
    const seen: number[] = [];
    const run = latestOnly(async (value: number) => {
      seen.push(value);
      if (value === 1) throw new Error('gone');
    });
    run(1);
    await vi.waitFor(() => expect(seen).toEqual([1]));
    await new Promise((resolve) => setImmediate(resolve));
    run(2);
    await vi.waitFor(() => expect(seen).toEqual([1, 2]));
  });
});
