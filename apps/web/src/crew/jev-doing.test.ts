import type { CrewMember, PieceList, TaskPiece } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { runningText } from '../chat/status/RunningLine.tsx';
import { COORDINATOR_DOING, doingPhrase, jevDoing } from './jev-doing.ts';
import { member, orchestration } from './test-orchestration.ts';

const RUN = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;

function piece(key: string, status: TaskPiece['status']): TaskPiece {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    key,
    title: `Piece ${key}`,
    goal: 'Goal',
    owns: ['a.ts'],
    reads: [],
    dependsOn: [],
    contract: null,
    contractVersion: 1,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 20_000,
    placement: 'in_order',
    provider: 'claude',
    model: 'sonnet-5',
    builderRunId: null,
    builderName: null,
    status,
    attempts: 0,
    fixTurns: 0,
    filesChanged: [],
    violations: [],
    check: null,
    costUsd: null,
    landedAt: null,
    note: null,
    notesQueued: 0,
    pickNote: null,
  };
}

function list(pieces: TaskPiece[]): PieceList {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    taskId: '00000000-0000-4000-8000-0000000000d2',
    version: 1,
    planVersion: null,
    piecesHash: 'hash',
    placement: 'in_order',
    placementReason: 'small pieces',
    status: 'approved',
    integration: null,
    pieces,
    createdAt: '2026-09-26T10:00:00.000Z',
  };
}

const coordinator = member({ runId: RUN(0), role: 'coordinator', name: 'Atlas' });

function builder(n: number, pieceKey: string, status: CrewMember['status'] = 'succeeded') {
  return member({ runId: RUN(n), name: `Bolt ${n}`, pieceKey, status });
}

function pieceTurn(pieces: TaskPiece[], crew: CrewMember[]) {
  return orchestration({ crew: [coordinator, ...crew], pieces: list(pieces) });
}

describe('what Jev is doing between agents', () => {
  it('reads the message while the turn is at intake', () => {
    expect(jevDoing(orchestration({ phase: 'intake' }), null)).toEqual({ kind: 'message' });
  });

  it('picks a model before the first agent starts', () => {
    expect(jevDoing(orchestration(), null)).toEqual({ kind: 'model', pieceKey: null });
  });

  it('picks models for the pieces once the Coordinator has written them', () => {
    const turn = orchestration({ phase: 'planning', crew: [coordinator] });
    expect(jevDoing(turn, 3)).toEqual({ kind: 'models', count: 3 });
    expect(jevDoing(turn, null)).toEqual({ kind: 'models', count: null });
  });

  it('picks a model for a piece that started without a Builder yet', () => {
    const turn = pieceTurn(
      [piece('P1', 'landed'), piece('P2', 'running'), piece('P3', 'pending')],
      [builder(1, 'P1')],
    );
    expect(jevDoing(turn, 3)).toEqual({ kind: 'model', pieceKey: 'P2' });
  });

  it('checks a piece whose Builder finished before it lands', () => {
    const turn = pieceTurn([piece('P1', 'running'), piece('P2', 'pending')], [builder(1, 'P1')]);
    expect(jevDoing(turn, 2)).toEqual({ kind: 'check', pieceKey: 'P1' });
  });

  it('checks the piece again after its fix turn', () => {
    const turn = pieceTurn(
      [piece('P1', 'running')],
      [builder(1, 'P1', 'failed'), builder(2, 'P1')],
    );
    expect(jevDoing(turn, 1)).toEqual({ kind: 'check', pieceKey: 'P1' });
  });

  it('chooses the next step between a landed piece and the next one', () => {
    const turn = pieceTurn([piece('P1', 'landed'), piece('P2', 'ready')], [builder(1, 'P1')]);
    expect(jevDoing(turn, 2)).toEqual({ kind: 'next' });
  });

  it('chooses the next step while a piece Builder is still queued', () => {
    const turn = pieceTurn([piece('P1', 'running')], [builder(1, 'P1', 'queued')]);
    expect(jevDoing(turn, 1)).toEqual({ kind: 'next' });
  });

  it('checks the whole change once every piece is settled', () => {
    const pieces = [piece('P1', 'landed'), piece('P2', 'skipped')];
    expect(jevDoing(pieceTurn(pieces, [builder(1, 'P1')]), 2)).toEqual({
      kind: 'check',
      pieceKey: null,
    });
    const glued = [builder(1, 'P1'), member({ runId: RUN(5), role: 'integrator' })];
    expect(jevDoing(pieceTurn(pieces, glued), 2)).toEqual({ kind: 'check', pieceKey: null });
  });

  it('checks the change after a single Builder', () => {
    const turn = orchestration({ crew: [member({ runId: RUN(1) })] });
    expect(jevDoing(turn, null)).toEqual({ kind: 'check', pieceKey: null });
  });

  it('chooses the next step after a review, an answer or an old turn it cannot read', () => {
    const reviewed = [member({ runId: RUN(1) }), member({ runId: RUN(2), role: 'critic' })];
    expect(jevDoing(orchestration({ phase: 'reviewing', crew: reviewed }), null)).toEqual({
      kind: 'next',
    });
    const answered = orchestration({ phase: 'scouting', crew: [member({ role: 'scout' })] });
    expect(jevDoing(answered, null)).toEqual({ kind: 'next' });
    expect(
      jevDoing(pieceTurn([piece('P1', 'landed')], [builder(1, 'P1'), reviewed[1]!]), 1),
    ).toEqual({ kind: 'next' });
  });
});

describe('the words for what Jev is doing', () => {
  it.each([
    [{ kind: 'message' } as const, 'reading your message'],
    [{ kind: 'models', count: 3 } as const, 'picking models for 3 pieces'],
    [{ kind: 'models', count: 1 } as const, 'picking a model for 1 piece'],
    [{ kind: 'models', count: null } as const, 'picking models for the pieces'],
    [{ kind: 'model', pieceKey: 'P2' } as const, 'picking a model for P2'],
    [{ kind: 'model', pieceKey: null } as const, 'picking a model'],
    [{ kind: 'check', pieceKey: 'P1' } as const, 'checking P1'],
    [{ kind: 'check', pieceKey: null } as const, 'checking the change'],
    [{ kind: 'next' } as const, 'choosing the next step'],
  ])('%o reads "%s"', (doing, phrase) => {
    expect(doingPhrase(doing)).toBe(phrase);
  });

  it('never says planning for the advisor, whatever it is called', () => {
    const lead = { id: 'lead', name: 'Sage', provider: 'jev', kind: 'lead' } as const;
    expect(runningText(lead, null)).toBe('Sage is choosing the next step…');
    const checking = { ...lead, doing: doingPhrase({ kind: 'check', pieceKey: 'P1' }) };
    expect(runningText(checking, null)).toBe('Sage is checking P1…');
  });

  it('gives the Coordinator its own planning line', () => {
    const atlas = { id: 'c', name: 'Atlas', provider: 'claude', kind: 'crew' } as const;
    expect(runningText({ ...atlas, doing: COORDINATOR_DOING }, null)).toBe(
      'Atlas is planning the pieces…',
    );
  });
});
