import { plainText, type MarkdownNode } from './heading-ids.ts';

const STACK_MIN_COLUMNS = 3;

function labelCells(table: MarkdownNode): void {
  const [header, ...rows] = table.children ?? [];
  const names = (header?.children ?? []).map(plainText);
  if (names.length < STACK_MIN_COLUMNS) return;
  for (const row of rows) {
    (row.children ?? []).forEach((cell, column) => {
      if (column === 0 || !names[column]) return;
      cell.data = {
        ...cell.data,
        hProperties: { ...cell.data?.hProperties, 'data-label': names[column] },
      };
    });
  }
}

function visit(node: MarkdownNode): void {
  if (node.type === 'table') labelCells(node);
  for (const child of node.children ?? []) visit(child);
}

export function remarkTableLabels() {
  return visit;
}
