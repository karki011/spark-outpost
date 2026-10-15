import type { BrowserActKind } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { outlineOf, type AxNode } from './outline.ts';
import { RefMap, type RefFacts } from './ref-map.ts';
import { attributesOf, type DomNode } from './sensitive-nodes.ts';

export interface DomEntry {
  node: DomNode;
  parent: number | null;
}

export interface PageDocument {
  root: DomNode;
  index: Map<number, DomEntry>;
}

export type RefindFor = 'read' | BrowserActKind | null;

export interface ResolvedRef {
  node: number;
  refound: boolean;
}

export class RefError extends Error {}

const SUBMIT_INPUTS = new Set(['submit', 'image']);
const ACT_RISKY: ReadonlySet<RefindFor> = new Set(['click', 'key']);

export function indexDocument(root: DomNode): Map<number, DomEntry> {
  const index = new Map<number, DomEntry>();
  const pending: DomEntry[] = [{ node: root, parent: null }];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    index.set(entry.node.backendNodeId, entry);
    const parent = entry.node.backendNodeId;
    const children = [...(entry.node.children ?? []), ...(entry.node.shadowRoots ?? [])];
    if (entry.node.contentDocument) children.push(entry.node.contentDocument);
    for (const node of children) pending.push({ node, parent });
  }
  return index;
}

export async function pageDocument(cdp: Cdp): Promise<PageDocument> {
  const { root } = await cdp.send<{ root: DomNode }>('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });
  return { root, index: indexDocument(root) };
}

function submitsOrNavigates(node: DomNode): boolean {
  const tag = node.nodeName.toUpperCase();
  const attributes = attributesOf(node);
  if (tag === 'FORM') return true;
  if (tag === 'A' || tag === 'AREA') return attributes.has('href');
  if (tag === 'INPUT') {
    return (
      SUBMIT_INPUTS.has((attributes.get('type') ?? '').toLowerCase()) || attributes.has('form')
    );
  }
  if (tag === 'BUTTON') {
    const type = (attributes.get('type') ?? 'submit').toLowerCase();
    return attributes.has('form') && type === 'submit';
  }
  return false;
}

export function mayNavigateOrSubmit(
  index: ReadonlyMap<number, DomEntry>,
  backendNodeId: number,
  role: string,
): boolean {
  if (role === 'link') return true;
  let entry = index.get(backendNodeId);
  while (entry) {
    if (submitsOrNavigates(entry.node)) return true;
    entry = entry.parent === null ? undefined : index.get(entry.parent);
  }
  return false;
}

function sameFacts(a: RefFacts, b: RefFacts): boolean {
  return a.role === b.role && a.name === b.name && a.context === b.context;
}

export function refindCandidates(
  nodes: readonly AxNode[],
  facts: RefFacts,
  index: ReadonlyMap<number, DomEntry>,
): number[] {
  const scratch = new RefMap();
  outlineOf(nodes, { refs: scratch, sensitive: new Set() });
  return [...scratch.factsByNode()]
    .filter(([node, found]) => index.has(node) && sameFacts(found, facts))
    .map(([node]) => node);
}

function gone(ref: string): RefError {
  return new RefError(`${ref} is gone: the page replaced that element. Read the page again.`);
}

function missing(ref: string, reason: 'malformed' | 'earlier_page' | 'unknown'): RefError {
  if (reason === 'earlier_page') {
    return new RefError(
      `${ref} is from an earlier page; this tab has loaded a new one since. Read the page again.`,
    );
  }
  return new RefError(`${ref} is not a ref on this tab's page. Read the page again.`);
}

function refusedRefind(ref: string): RefError {
  return new RefError(
    `${ref} is gone: the page replaced that element, and Spark does not look again for a link, a submit button or anything in a form. Read the page again.`,
  );
}

export async function resolveRef(
  cdp: Cdp,
  refs: RefMap,
  ref: string,
  page: PageDocument,
  refindFor: RefindFor,
): Promise<ResolvedRef> {
  refs.useDocument(page.root.backendNodeId);
  const found = refs.lookup(ref);
  if (!found.found) throw missing(ref, found.reason);
  if (page.index.has(found.node)) return { node: found.node, refound: false };
  const facts = found.facts;
  if (refindFor === null || !found.refindable || !facts?.name) throw gone(ref);
  if (ACT_RISKY.has(refindFor) && facts.role === 'link') throw refusedRefind(ref);
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
  const candidates = refindCandidates(nodes, facts, page.index);
  if (candidates.length !== 1) throw gone(ref);
  const node = candidates[0]!;
  if (ACT_RISKY.has(refindFor) && mayNavigateOrSubmit(page.index, node, facts.role)) {
    throw refusedRefind(ref);
  }
  refs.rebind(ref, node);
  return { node, refound: true };
}
