import { BROWSER_ACT_NAME_MAX, type BrowserActTarget } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { sensitiveByName, type AxNode } from './outline.ts';
import { isSensitiveField, type DomNode } from './sensitive-nodes.ts';

function axText(value: { value?: unknown } | undefined): string {
  return typeof value?.value === 'string' ? value.value.replace(/\s+/g, ' ').trim() : '';
}

async function roleAndName(cdp: Cdp, backendNodeId: number) {
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getPartialAXTree', {
    backendNodeId,
    fetchRelatives: false,
  });
  const node =
    nodes.find((candidate) => candidate.backendDOMNodeId === backendNodeId && !candidate.ignored) ??
    nodes.find((candidate) => !candidate.ignored) ??
    nodes[0];
  return { role: axText(node?.role) || 'generic', name: axText(node?.name) };
}

async function sensitiveField(cdp: Cdp, backendNodeId: number): Promise<boolean> {
  const { node } = await cdp.send<{ node: DomNode }>('DOM.describeNode', { backendNodeId });
  return isSensitiveField(node);
}

export async function describeTarget(
  cdp: Cdp,
  backendNodeId: number,
  filled: ReadonlySet<number>,
): Promise<BrowserActTarget> {
  const { role, name } = await roleAndName(cdp, backendNodeId);
  const sensitive =
    filled.has(backendNodeId) ||
    sensitiveByName(role, name) ||
    (await sensitiveField(cdp, backendNodeId));
  return {
    role: role.slice(0, 80),
    name: sensitive ? '' : name.slice(0, BROWSER_ACT_NAME_MAX),
    sensitive,
  };
}
