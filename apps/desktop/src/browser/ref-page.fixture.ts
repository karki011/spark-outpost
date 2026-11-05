import type { Cdp } from './cdp.ts';
import type { AxNode } from './outline.ts';
import type { DomNode } from './sensitive-nodes.ts';

export interface El {
  id: number;
  role: string;
  name?: string;
  tag?: string;
  attrs?: string[];
  value?: string;
  modal?: boolean;
  kids?: El[];
}

export interface FakeDocument {
  documentId: number;
  body: El;
  hit?: number;
}

export function el(id: number, role: string, name = '', more: Partial<El> = {}): El {
  return { id, role, name, ...more };
}

export function text(id: number, words: string): El {
  return { id, role: 'StaticText', name: words, tag: '#text' };
}

function axNodes(node: El, parentId: string | undefined, out: AxNode[]): void {
  out.push({
    nodeId: String(node.id),
    ...(parentId === undefined ? {} : { parentId }),
    role: { value: node.role },
    name: { value: node.name ?? '' },
    ...(node.value === undefined ? {} : { value: { value: node.value } }),
    ...(node.modal ? { properties: [{ name: 'modal', value: { value: true } }] } : {}),
    backendDOMNodeId: node.id,
    childIds: (node.kids ?? []).map((kid) => String(kid.id)),
  });
  for (const kid of node.kids ?? []) axNodes(kid, String(node.id), out);
}

function domNode(node: El): DomNode {
  return {
    backendNodeId: node.id,
    nodeName: node.tag ?? 'DIV',
    ...(node.attrs ? { attributes: node.attrs } : {}),
    children: (node.kids ?? []).map(domNode),
  };
}

export function axOf(page: FakeDocument): AxNode[] {
  const out: AxNode[] = [];
  axNodes(page.body, undefined, out);
  return out;
}

export function domOf(page: FakeDocument): DomNode {
  return { backendNodeId: page.documentId, nodeName: '#document', children: [domNode(page.body)] };
}

export function answerFor(page: () => FakeDocument) {
  return (method: string): unknown => {
    if (method === 'Accessibility.getFullAXTree') return { nodes: axOf(page()) };
    if (method === 'DOM.getDocument') return { root: domOf(page()) };
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } };
    }
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: page().hit ?? page().body.id };
    return {};
  };
}

export function fakeCdp(page: () => FakeDocument): Cdp {
  const answer = answerFor(page);
  return {
    send: (method) => Promise.resolve(answer(method) as never),
    listen: () => () => undefined,
    detach: () => undefined,
  };
}
