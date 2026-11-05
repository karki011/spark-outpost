import type { AxNode } from './outline.ts';

const ANCESTORS_NAMED = 3;
const LEVELS_UP = 3;
const SIBLINGS_BACK = 4;
const SUBTREE_NODES = 60;
const TEXT_MAX = 80;

function nameOf(node: AxNode): string {
  const value = node.name?.value;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : '';
}

function roleOf(node: AxNode): string {
  const value = node.role?.value;
  return typeof value === 'string' ? value : '';
}
function lastNameIn(
  byId: ReadonlyMap<string, AxNode>,
  id: string,
  budget: { left: number },
): string {
  const node = byId.get(id);
  if (!node || budget.left <= 0) return '';
  budget.left -= 1;
  const kids = node.childIds ?? [];
  for (let index = kids.length - 1; index >= 0; index -= 1) {
    const found = lastNameIn(byId, kids[index]!, budget);
    if (found) return found;
  }
  return node.ignored ? '' : nameOf(node);
}

function textBefore(byId: ReadonlyMap<string, AxNode>, start: AxNode): string {
  let node: AxNode | undefined = start;
  for (let level = 0; level < LEVELS_UP && node?.parentId; level += 1) {
    const parent = byId.get(node.parentId);
    if (!parent) return '';
    const siblings = parent.childIds ?? [];
    const at = siblings.indexOf(node.nodeId);
    for (let index = at - 1; index >= Math.max(0, at - SIBLINGS_BACK); index -= 1) {
      const found = lastNameIn(byId, siblings[index]!, { left: SUBTREE_NODES });
      if (found) return found.slice(0, TEXT_MAX);
    }
    node = parent;
  }
  return '';
}

function namedAncestors(byId: ReadonlyMap<string, AxNode>, start: AxNode): string[] {
  const names: string[] = [];
  let parentId = start.parentId;
  while (parentId && names.length < ANCESTORS_NAMED) {
    const parent = byId.get(parentId);
    if (!parent) break;
    const role = roleOf(parent);
    const name = nameOf(parent);
    if (!parent.ignored && name && role !== 'RootWebArea') {
      names.push(`${role}:${name.slice(0, TEXT_MAX)}`);
    }
    parentId = parent.parentId;
  }
  return names;
}

export function refContextOf(byId: ReadonlyMap<string, AxNode>, node: AxNode): string {
  return `${namedAncestors(byId, node).join('>')}|${textBefore(byId, node)}`;
}
