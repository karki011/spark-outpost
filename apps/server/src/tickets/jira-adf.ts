interface AdfNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: unknown;
}

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'rule',
  'panel',
  'table',
  'tableRow',
]);

function children(node: AdfNode): AdfNode[] {
  return Array.isArray(node.content) ? (node.content as AdfNode[]) : [];
}

function headingLevel(node: AdfNode): number {
  const level = (node.attrs as { level?: unknown } | undefined)?.level;
  return typeof level === 'number' && level >= 1 && level <= 6 ? level : 2;
}

function listItems(node: AdfNode, ordered: boolean): string {
  return children(node)
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- ';
      const body = children(item).map(render).join('').trim();
      return `${marker}${body.replaceAll('\n', '\n  ')}\n`;
    })
    .join('');
}

function render(node: AdfNode): string {
  const inner = () => children(node).map(render).join('');
  switch (node.type) {
    case 'text':
      return typeof node.text === 'string' ? node.text : '';
    case 'hardBreak':
      return '\n';
    case 'mention':
    case 'emoji': {
      const text = (node.attrs as { text?: unknown } | undefined)?.text;
      return typeof text === 'string' ? text : '';
    }
    case 'heading':
      return `${'#'.repeat(headingLevel(node))} ${inner().trim()}\n\n`;
    case 'bulletList':
      return `${listItems(node, false)}\n`;
    case 'orderedList':
      return `${listItems(node, true)}\n`;
    case 'codeBlock':
      return `\`\`\`\n${inner()}\n\`\`\`\n\n`;
    case 'rule':
      return '---\n\n';
    case 'tableCell':
    case 'tableHeader':
      return `${inner().trim()} | `;
    default:
      return typeof node.type === 'string' && BLOCKS.has(node.type)
        ? `${inner().trimEnd()}\n\n`
        : inner();
  }
}

export function adfToText(doc: unknown): string {
  if (typeof doc === 'string') return doc;
  if (!doc || typeof doc !== 'object') return '';
  return render(doc as AdfNode)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textToAdf(text: string) {
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((paragraph) => ({
      type: 'paragraph',
      content: paragraph
        .split('\n')
        .flatMap((line, index) => [
          ...(index > 0 ? [{ type: 'hardBreak' }] : []),
          ...(line ? [{ type: 'text', text: line }] : []),
        ]),
    })),
  };
}
