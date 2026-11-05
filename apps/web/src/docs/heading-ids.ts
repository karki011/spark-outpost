import { uniqueAnchors } from '@spark-outpost/contracts';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

export const DOC_HEADING_PREFIX = 'doc-';

function plain(node: MarkdownNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(plain).join('');
}

function headingsIn(node: MarkdownNode, found: MarkdownNode[] = []): MarkdownNode[] {
  if (node.type === 'heading') found.push(node);
  for (const child of node.children ?? []) headingsIn(child, found);
  return found;
}

export function remarkHeadingIds() {
  return (tree: MarkdownNode) => {
    const headings = headingsIn(tree);
    const anchors = uniqueAnchors(headings.map(plain));
    headings.forEach((heading, index) => {
      heading.data = {
        ...heading.data,
        hProperties: {
          ...heading.data?.hProperties,
          id: `${DOC_HEADING_PREFIX}${anchors[index]}`,
          tabIndex: -1,
        },
      };
    });
  };
}
