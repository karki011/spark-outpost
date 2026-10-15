import {
  BROWSER_READ_MAX_CHARS,
  type BrowserBox,
  type BrowserReadMode,
} from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { quadBox } from './mask.ts';
import { modalDialogOf } from './modal-scope.ts';
import { outlineOf, pageOfLines, pageTextOf, type AxNode } from './outline.ts';
import { budgetPage } from './read-budget.ts';
import type { RefMap } from './ref-map.ts';
import { pageDocument, resolveRef } from './ref-resolve.ts';
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

export interface ReadRequest {
  mode: BrowserReadMode;
  ref?: string | undefined;
  offset: number;
  maxChars?: number | undefined;
}

export async function readPage(
  cdp: Cdp,
  refs: RefMap,
  request: ReadRequest,
  filled: ReadonlySet<number> = new Set(),
) {
  const document = await pageDocument(cdp);
  const asked =
    request.ref === undefined
      ? null
      : (await resolveRef(cdp, refs, request.ref, document, 'read')).node;
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
  const sensitive = new Set([...sensitiveNodes(document.root), ...filled]);
  const dialog = asked === null ? await modalDialogOf(cdp, nodes, document.index) : null;
  const rootBackendId = asked ?? dialog?.node ?? null;
  const pageRef = dialog ? refs.refFor(dialog.page) : null;
  const scope = dialog && pageRef ? { dialog: true, pageRef } : {};
  const maxChars = request.maxChars ?? BROWSER_READ_MAX_CHARS;
  if (request.mode === 'text') {
    const lines = pageTextOf(nodes, sensitive, rootBackendId);
    return { ...pageOfLines(lines, request.offset, maxChars), masked: 0, leftOut: 0, ...scope };
  }
  const outline = outlineOf(nodes, { refs, sensitive, rootBackendId });
  if (!outline) throw new PageToolError('no_ref', 'That part of the page is gone. Read it again.');
  return {
    ...budgetPage(outline.rows, request.offset, maxChars),
    masked: outline.masked,
    ...scope,
  };
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
