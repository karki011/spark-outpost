import { describe, expect, it } from 'vitest';
import { mainRegionOf } from './main-scope.ts';
import { pageTextOf, type AxNode } from './outline.ts';

function node(id: string, role: string, children: string[], extra: Partial<AxNode> = {}): AxNode {
  return {
    nodeId: id,
    role: { value: role },
    childIds: children,
    backendDOMNodeId: Number(id),
    ...extra,
  };
}

function words(id: string, parentId: string, value: string): AxNode {
  return { nodeId: id, parentId, role: { value: 'StaticText' }, name: { value: value } };
}

const nav = [
  node('2', 'navigation', ['20'], { parentId: '1' }),
  words('20', '2', 'Home Pricing Docs'),
];

describe('the main region of a page', () => {
  it('reads only the main landmark when there is one', () => {
    const nodes = [
      node('1', 'RootWebArea', ['2', '3']),
      ...nav,
      node('3', 'main', ['30'], { parentId: '1' }),
      words('30', '3', 'Cost by service'),
    ];
    const main = mainRegionOf(nodes, new Set());
    expect(main).toBe(3);
    expect(pageTextOf(nodes, new Set(), main)).toEqual(['Cost by service']);
  });

  it('falls back to the largest article', () => {
    const nodes = [
      node('1', 'RootWebArea', ['2', '4', '5']),
      ...nav,
      node('4', 'article', ['40'], { parentId: '1' }),
      words('40', '4', 'Short note'),
      node('5', 'article', ['50'], { parentId: '1' }),
      words('50', '5', 'A much longer story about the bill'),
    ];
    expect(mainRegionOf(nodes, new Set())).toBe(5);
  });

  it('finds nothing on a page with neither, so the whole page is read', () => {
    const nodes = [node('1', 'RootWebArea', ['2']), ...nav];
    expect(mainRegionOf(nodes, new Set())).toBeNull();
  });

  it('skips an ignored main', () => {
    const nodes = [
      node('1', 'RootWebArea', ['3']),
      node('3', 'main', [], { parentId: '1', ignored: true }),
    ];
    expect(mainRegionOf(nodes, new Set())).toBeNull();
  });
});
