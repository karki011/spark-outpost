import { describe, expect, it } from 'vitest';
import {
  MASKED_VALUE,
  RefMap,
  outlineOf,
  pageOfLines,
  pageTextOf,
  type AxNode,
} from './outline.ts';
import { sensitiveNodes } from './sensitive-nodes.ts';

function node(
  nodeId: string,
  role: string,
  name: string,
  more: Partial<AxNode> & { children?: string[]; dom?: number; val?: string } = {},
): AxNode {
  const { children, dom, val, ...rest } = more;
  return {
    nodeId,
    role: { value: role },
    name: { value: name },
    ...(val === undefined ? {} : { value: { value: val } }),
    ...(children ? { childIds: children } : {}),
    ...(dom === undefined ? {} : { backendDOMNodeId: dom }),
    ...rest,
  };
}

const PAGE: AxNode[] = [
  node('1', 'RootWebArea', 'Sign in', { children: ['2', '3'], dom: 1 }),
  node('2', 'heading', 'Sign in', {
    parentId: '1',
    children: ['2t'],
    dom: 10,
    properties: [{ name: 'level', value: { value: 1 } }],
  }),
  node('2t', 'StaticText', 'Sign in', { parentId: '2', dom: 11 }),
  node('3', 'generic', '', { parentId: '1', children: ['4', '5', '6', '7'], dom: 12 }),
  node('4', 'textbox', 'Email', {
    parentId: '3',
    children: ['4t'],
    dom: 20,
    val: 'ada@example.test',
  }),
  node('4t', 'StaticText', 'ada@example.test', { parentId: '4', dom: 30 }),
  node('5', 'textbox', 'Password', { parentId: '3', children: ['5t'], dom: 21, val: 'hunter2' }),
  node('5t', 'StaticText', 'hunter2', { parentId: '5', dom: 31 }),
  node('6', 'textbox', 'Card', {
    parentId: '3',
    children: ['6t'],
    dom: 22,
    val: '4242424242424242',
  }),
  node('6t', 'StaticText', '4242424242424242', { parentId: '6', dom: 32 }),
  node('7', 'button', 'Continue', {
    parentId: '3',
    children: ['7t'],
    dom: 23,
    properties: [{ name: 'disabled', value: { value: true } }],
  }),
  node('7t', 'StaticText', 'Continue', { parentId: '7', dom: 24 }),
];

describe('accessibility outline', () => {
  it('lists roles, names and refs, and flattens empty wrappers', () => {
    const outline = outlineOf(PAGE, { refs: new RefMap(), sensitive: new Set([22]) })!;
    expect(outline.lines).toEqual([
      '- RootWebArea "Sign in" [ref_1]',
      '  - heading "Sign in" [ref_2] level=1',
      '  - textbox "Email" [ref_3] value="ada@example.test"',
      `  - textbox "Password" [ref_4] value=${MASKED_VALUE}`,
      `  - textbox "Card" [ref_5] value=${MASKED_VALUE}`,
      '  - button "Continue" [ref_6] disabled',
    ]);
    expect(outline.masked).toBe(2);
    expect(outline.lines.join('\n')).not.toContain('hunter2');
    expect(outline.lines.join('\n')).not.toContain('4242');
  });

  it('keeps the same ref for the same element across reads', () => {
    const refs = new RefMap();
    outlineOf(PAGE, { refs, sensitive: new Set() });
    const again = outlineOf([...PAGE].reverse(), { refs, sensitive: new Set() })!;
    expect(again.lines.at(-1)).toContain('button "Continue" [ref_6]');
    expect(refs.nodeFor('ref_6')).toBe(23);
    expect(refs.nodeFor('ref_99')).toBeNull();
    expect(refs.nodeFor('6')).toBeNull();
  });

  it('reads one part of the page by ref', () => {
    const refs = new RefMap();
    outlineOf(PAGE, { refs, sensitive: new Set() });
    const part = outlineOf(PAGE, {
      refs,
      sensitive: new Set(),
      rootBackendId: refs.nodeFor('ref_6'),
    })!;
    expect(part.lines).toEqual(['- button "Continue" [ref_6] disabled']);
    expect(outlineOf(PAGE, { refs, sensitive: new Set(), rootBackendId: 999 })).toBeNull();
  });

  it('forgets refs after a navigation', () => {
    const refs = new RefMap();
    refs.refFor(23);
    refs.clear();
    expect(refs.nodeFor('ref_1')).toBeNull();
  });

  it('gives page text without any field values', () => {
    const lines = pageTextOf(PAGE, new Set([22]));
    expect(lines).toEqual(['Sign in', 'Continue']);
    expect(pageTextOf(PAGE).join(' ')).not.toMatch(/hunter2|4242|ada@/);
  });

  it('pages lines within the character cap', () => {
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index} ${'x'.repeat(20)}`);
    const first = pageOfLines(lines, 0, 100);
    expect(first.nextOffset).toBe(3);
    expect(first.text.length).toBeLessThanOrEqual(100);
    const rest = pageOfLines(lines, 9, 100);
    expect(rest).toMatchObject({ offset: 9, nextOffset: null, total: 10 });
    expect(pageOfLines(lines, 50, 100)).toMatchObject({ text: '', offset: 10, nextOffset: null });
  });
});

describe('sensitive fields', () => {
  it('finds password, card and one-time-code fields, through shadow roots and frames', () => {
    const found = sensitiveNodes({
      backendNodeId: 1,
      nodeName: '#document',
      children: [
        { backendNodeId: 2, nodeName: 'INPUT', attributes: ['type', 'password'] },
        { backendNodeId: 3, nodeName: 'INPUT', attributes: ['type', 'text', 'name', 'email'] },
        { backendNodeId: 4, nodeName: 'INPUT', attributes: ['autocomplete', 'cc-number'] },
        {
          backendNodeId: 5,
          nodeName: 'DIV',
          shadowRoots: [
            {
              backendNodeId: 6,
              nodeName: '#document-fragment',
              children: [{ backendNodeId: 7, nodeName: 'INPUT', attributes: ['name', 'cvv'] }],
            },
          ],
        },
        {
          backendNodeId: 8,
          nodeName: 'IFRAME',
          contentDocument: {
            backendNodeId: 9,
            nodeName: '#document',
            children: [
              {
                backendNodeId: 10,
                nodeName: 'INPUT',
                attributes: ['autocomplete', 'one-time-code'],
              },
            ],
          },
        },
        { backendNodeId: 11, nodeName: 'DIV', attributes: ['id', 'password-help'] },
      ],
    });
    expect(found.sort((a, b) => a - b)).toEqual([2, 4, 7, 10]);
  });
});
