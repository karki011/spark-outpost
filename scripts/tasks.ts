import { readFileSync, writeFileSync } from 'node:fs';
import {
  boardSchema,
  isTaskStatus,
  moveTask,
  renderKanban,
  statuses,
  type Board,
} from './board.ts';

const BOARD_PATH = 'docs/tasks/board.json';
const KANBAN_PATH = 'docs/KANBAN.md';

function readBoard(): Board {
  return boardSchema.parse(JSON.parse(readFileSync(BOARD_PATH, 'utf8')));
}

function writeBoard(board: Board): void {
  writeFileSync(BOARD_PATH, `${JSON.stringify(board, null, 2)}\n`);
  writeFileSync(KANBAN_PATH, renderKanban(board));
}

const [command, id, status, note = ''] = process.argv.slice(2);

if (command === 'render') {
  writeBoard(readBoard());
  console.log(`Rendered ${KANBAN_PATH}.`);
} else if (command === 'move' && id && status && isTaskStatus(status)) {
  const today = new Date().toISOString().slice(0, 10);
  writeBoard(moveTask(readBoard(), id, status, note, today));
  console.log(`Moved ${id} to ${status}.`);
} else {
  console.error(
    `Usage:\n  pnpm tasks move <ID> <${statuses.join('|')}> "note"\n  pnpm tasks render`,
  );
  process.exit(1);
}
