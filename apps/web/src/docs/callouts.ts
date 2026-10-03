interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

const KINDS: Readonly<Record<string, string>> = {
  tip: 'tip',
  note: 'note',
  important: 'important',
};

function calloutKind(quote: MarkdownNode): string | null {
  const lead = quote.children?.[0]?.children?.[0];
  if (lead?.type !== 'strong') return null;
  const label = (lead.children?.[0]?.value ?? '').replace(/[:.]\s*$/, '').toLowerCase();
  return KINDS[label] ?? null;
}

function mark(node: MarkdownNode): void {
  if (node.type === 'blockquote') {
    const kind = calloutKind(node);
    if (kind) {
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, className: `doc-callout doc-callout-${kind}` },
      };
    }
  }
  for (const child of node.children ?? []) mark(child);
}

export function remarkCallouts() {
  return mark;
}
