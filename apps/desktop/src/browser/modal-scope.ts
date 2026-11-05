import type { Cdp } from './cdp.ts';
import type { AxNode } from './outline.ts';
import type { DomEntry } from './ref-resolve.ts';

export interface ModalScope {
  node: number;
  page: number;
}

const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);

function isModal(node: AxNode): boolean {
  return (node.properties ?? []).some(
    (property) =>
      property.name === 'modal' &&
      (property.value.value === true || property.value.value === 'true'),
  );
}

function within(index: ReadonlyMap<number, DomEntry>, node: number, ancestor: number): boolean {
  let entry = index.get(node);
  while (entry) {
    if (entry.node.backendNodeId === ancestor) return true;
    entry = entry.parent === null ? undefined : index.get(entry.parent);
  }
  return false;
}

async function coversCentre(
  cdp: Cdp,
  index: ReadonlyMap<number, DomEntry>,
  dialog: number,
): Promise<boolean> {
  try {
    const { cssVisualViewport: view } = await cdp.send<{
      cssVisualViewport: { clientWidth: number; clientHeight: number };
    }>('Page.getLayoutMetrics');
    const { backendNodeId } = await cdp.send<{ backendNodeId: number }>('DOM.getNodeForLocation', {
      x: Math.round(view.clientWidth / 2),
      y: Math.round(view.clientHeight / 2),
      ignorePointerEventsNone: true,
    });
    return within(index, backendNodeId, dialog);
  } catch {
    return false;
  }
}

export async function modalDialogOf(
  cdp: Cdp,
  nodes: readonly AxNode[],
  index: ReadonlyMap<number, DomEntry>,
): Promise<ModalScope | null> {
  const page = nodes.find((node) => node.parentId === undefined)?.backendDOMNodeId;
  if (page === undefined) return null;
  const dialogs = nodes.filter(
    (node) =>
      !node.ignored &&
      node.backendDOMNodeId !== undefined &&
      index.has(node.backendDOMNodeId) &&
      DIALOG_ROLES.has(typeof node.role?.value === 'string' ? node.role.value : ''),
  );
  const modal = dialogs.filter(isModal).at(-1) ?? null;
  if (modal) return { node: modal.backendDOMNodeId!, page };
  const topmost = dialogs.at(-1);
  if (!topmost || !(await coversCentre(cdp, index, topmost.backendDOMNodeId!))) return null;
  return { node: topmost.backendDOMNodeId!, page };
}
