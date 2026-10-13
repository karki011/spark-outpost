import type { BrowserBox, BrowserReadMode } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { quadBox } from './mask.ts';
import { outlineOf, pageOfLines, pageTextOf, type AxNode, type RefMap } from './outline.ts';
import { sensitiveNodes, type DomNode } from './sensitive-nodes.ts';

export type PageToolErrorCode = 'no_ref' | 'failed' | 'sensitive_field';

export class PageToolError extends Error {
  readonly code: PageToolErrorCode;

  constructor(code: PageToolErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function sensitiveBackendIds(cdp: Cdp): Promise<number[]> {
  const { root } = await cdp.send<{ root: DomNode }>('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });
  return sensitiveNodes(root);
}

function nodeForRef(refs: RefMap, ref: string | undefined): number | null {
  if (ref === undefined) return null;
  const node = refs.nodeFor(ref);
  if (node === null) {
    throw new PageToolError('no_ref', `${ref} is not on this page any more. Read the page again.`);
  }
  return node;
}

export interface ReadRequest {
  mode: BrowserReadMode;
  ref?: string | undefined;
  offset: number;
}

export async function readPage(
  cdp: Cdp,
  refs: RefMap,
  request: ReadRequest,
  filled: ReadonlySet<number> = new Set(),
) {
  const rootBackendId = nodeForRef(refs, request.ref);
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
  const sensitive = new Set([...(await sensitiveBackendIds(cdp)), ...filled]);
  if (request.mode === 'text') {
    const lines = pageTextOf(nodes, sensitive, rootBackendId);
    return { ...pageOfLines(lines, request.offset), masked: 0 };
  }
  const outline = outlineOf(nodes, { refs, sensitive, rootBackendId });
  if (!outline) throw new PageToolError('no_ref', 'That part of the page is gone. Read it again.');
  return { ...pageOfLines(outline.lines, request.offset), masked: outline.masked };
}

export async function boxOf(cdp: Cdp, backendNodeId: number): Promise<BrowserBox | null> {
  try {
    const { model } = await cdp.send<{ model: { border: number[] } }>('DOM.getBoxModel', {
      backendNodeId,
    });
    return quadBox(model.border);
  } catch {
    return null;
  }
}
