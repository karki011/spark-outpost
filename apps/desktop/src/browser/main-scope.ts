import { pageTextOf, type AxNode } from './outline.ts';

function roleIs(node: AxNode, role: string): boolean {
  return !node.ignored && node.role?.value === role && node.backendDOMNodeId !== undefined;
}

function textSize(nodes: readonly AxNode[], sensitive: ReadonlySet<number>, node: AxNode): number {
  return pageTextOf(nodes, sensitive, node.backendDOMNodeId).join(' ').length;
}

export function mainRegionOf(
  nodes: readonly AxNode[],
  sensitive: ReadonlySet<number>,
): number | null {
  const main = nodes.find((node) => roleIs(node, 'main'));
  if (main) return main.backendDOMNodeId!;
  let best: { node: AxNode; size: number } | null = null;
  for (const node of nodes.filter((candidate) => roleIs(candidate, 'article'))) {
    const size = textSize(nodes, sensitive, node);
    if (size > 0 && (best === null || size > best.size)) best = { node, size };
  }
  return best?.node.backendDOMNodeId ?? null;
}
