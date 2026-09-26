import { describe, expect, it } from 'vitest';
import { moveTask, renderKanban, type Board } from './board.ts';

const board: Board = {
  tasks: [{ id: 'F-1', title: 'First', phase: '0', status: 'ready', acceptance: [], notes: [] }],
};

describe('moveTask', () => {
  it('moves a task and records the note', () => {
    const moved = moveTask(board, 'F-1', 'in_progress', 'Started', '2026-09-25');
    expect(moved.tasks[0]).toMatchObject({
      status: 'in_progress',
      notes: [{ date: '2026-09-25', status: 'in_progress', text: 'Started' }],
    });
  });

  it('requires evidence to mark a task done', () => {
    expect(() => moveTask(board, 'F-1', 'done', ' ', '2026-09-25')).toThrow(/evidence/);
  });

  it('rejects unknown tasks', () => {
    expect(() => moveTask(board, 'F-9', 'ready', '', '2026-09-25')).toThrow(/does not exist/);
  });
});

describe('renderKanban', () => {
  it('lists tasks under their status', () => {
    expect(renderKanban(board)).toContain('## Ready (1)\n\n- **F-1** First');
  });
});
