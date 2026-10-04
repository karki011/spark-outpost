export interface DomNode {
  backendNodeId: number;
  nodeName: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

const SENSITIVE_AUTOCOMPLETE =
  /(^|\s)(cc-[a-z-]+|current-password|new-password|one-time-code)(\s|$)/i;
const SENSITIVE_FIELD =
  /pass(word|wd|code)|card.?(number|num|no)|cc.?(num|number|csc|cvv)|cvv|cvc|otp|secret|token/i;
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA']);

function attributesOf(node: DomNode): Map<string, string> {
  const found = new Map<string, string>();
  const list = node.attributes ?? [];
  for (let index = 0; index + 1 < list.length; index += 2) {
    found.set(list[index]!.toLowerCase(), list[index + 1]!);
  }
  return found;
}

export function isSensitiveField(node: DomNode): boolean {
  if (!FIELD_TAGS.has(node.nodeName.toUpperCase())) return false;
  const attributes = attributesOf(node);
  if ((attributes.get('type') ?? '').toLowerCase() === 'password') return true;
  if (SENSITIVE_AUTOCOMPLETE.test(attributes.get('autocomplete') ?? '')) return true;
  return ['name', 'id', 'aria-label', 'placeholder'].some((name) =>
    SENSITIVE_FIELD.test(attributes.get(name) ?? ''),
  );
}

export function sensitiveNodes(root: DomNode): number[] {
  const found: number[] = [];
  const pending: DomNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (isSensitiveField(node)) found.push(node.backendNodeId);
    pending.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
    if (node.contentDocument) pending.push(node.contentDocument);
  }
  return found;
}
