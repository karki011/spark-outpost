import { describe, expect, it } from 'vitest';
import type { PieceList, TaskPiece } from '@spark-outpost/contracts';
import { steerablePieces, steerChoices } from './steer-targets.ts';
import { orchestration } from './test-orchestration.ts';

const TASK = '00000000-0000-4000-8000-0000000000f1';

function piece(key: string, status: TaskPiece['status'], extra: Partial<TaskPiece> = {}) {
  return { key, title: `Piece ${key}`, status, research: false, builderName: null, ...extra };
}

function list(pieces: ReturnType<typeof piece>[]): PieceList {
  return { pieces } as unknown as PieceList;
}

describe('steer targets', () => {
  it('offers steering only while a task with open pieces runs', () => {
    const open = list([piece('P1', 'landed'), piece('P2', 'running')]);
    const running = orchestration({ taskId: TASK, status: 'running', pieces: open });
    expect(steerablePieces(running)).toBe(open);
    expect(steerablePieces({ ...running, status: 'succeeded' })).toBeNull();
    expect(steerablePieces({ ...running, taskId: null })).toBeNull();
    const done = list([piece('P1', 'landed'), piece('R1', 'pending', { research: true })]);
    expect(steerablePieces({ ...running, pieces: done })).toBeNull();
    expect(steerablePieces(null)).toBeNull();
  });

  it('lists auto, all, each open piece with its Builder, then the coordinator', () => {
    const choices = steerChoices(
      list([
        piece('P1', 'landed'),
        piece('P2', 'running', { builderName: 'Rivet' }),
        piece('P3', 'pending'),
      ]),
    );
    expect(choices.map((choice) => [choice.id, choice.label, choice.description])).toEqual([
      ['auto', 'Auto', 'By the words you type'],
      ['all', 'All pieces', 'Every piece still open'],
      ['P2', 'P2 · Piece P2', 'Rivet · running'],
      ['P3', 'P3 · Piece P3', 'pending'],
      ['coordinator', 'Coordinator', 'Read at integration'],
    ]);
  });
});
