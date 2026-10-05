import type { DomNode } from './sensitive-nodes.ts';

let nextId = 1;

export function el(
  nodeName: string,
  attributes: Record<string, string> = {},
  children: DomNode[] = [],
): DomNode {
  nextId += 1;
  return {
    backendNodeId: nextId,
    nodeName,
    attributes: Object.entries(attributes).flat(),
    children,
  };
}

export function frame(document: DomNode): DomNode {
  return { ...el('IFRAME'), contentDocument: document };
}

export interface LoginDom {
  root: DomNode;
  username: DomNode;
  password: DomNode;
}

export function loginDom(): LoginDom {
  const username = el('INPUT', { type: 'email', name: 'email' });
  const password = el('INPUT', { type: 'password', name: 'password' });
  const root = el('HTML', {}, [
    el('FORM', {}, [username, password, el('BUTTON', { type: 'submit' })]),
  ]);
  return { root, username, password };
}

export function usernameStepDom(): { root: DomNode; username: DomNode } {
  const username = el('INPUT', { type: 'text', autocomplete: 'username' });
  return { root: el('HTML', {}, [el('FORM', {}, [username, el('BUTTON')])]), username };
}

export function passwordStepDom(): { root: DomNode; password: DomNode } {
  const password = el('INPUT', { type: 'password', autocomplete: 'current-password' });
  return { root: el('HTML', {}, [el('FORM', {}, [password, el('BUTTON')])]), password };
}

export function idsOf(...nodes: DomNode[]): Set<number> {
  return new Set(nodes.map((node) => node.backendNodeId));
}
