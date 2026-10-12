import type { Box } from '../../chat/quotes/toolbar-position.ts';

interface CellPosition {
  x: number;
  y: number;
}

interface BoxesInput {
  start: CellPosition;
  end: CellPosition;
  viewportY: number;
  cols: number;
  rows: number;
  screen: Box;
}

export interface SelectionBoxes {
  start: Box;
  end: Box;
}

export function selectionBoxes(input: BoxesInput): SelectionBoxes | null {
  const { start, end, viewportY, cols, rows, screen } = input;
  if (cols <= 0 || rows <= 0) return null;
  const cellWidth = (screen.right - screen.left) / cols;
  const cellHeight = (screen.bottom - screen.top) / rows;
  if (cellWidth <= 0 || cellHeight <= 0) return null;
  const rowTop = (row: number) => screen.top + (row - viewportY) * cellHeight;
  const column = (x: number) => screen.left + Math.min(Math.max(x, 0), cols) * cellWidth;
  const startLeft = column(start.x);
  const endRight = column(end.x);
  return {
    start: {
      left: startLeft,
      right: Math.min(startLeft + cellWidth, screen.right),
      top: rowTop(start.y),
      bottom: rowTop(start.y) + cellHeight,
    },
    end: {
      left: Math.max(endRight - cellWidth, screen.left),
      right: endRight,
      top: rowTop(end.y),
      bottom: rowTop(end.y) + cellHeight,
    },
  };
}
