import type { ConversationDetail, PieceList, TaskPiece } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { crewAgents } from './crew-projection.ts';
import { member, orchestration } from './test-orchestration.ts';
import { tvCaption } from './tv-caption.ts';
import { coordinatorScene, pieceTagText } from './tv-coordinator.ts';
import { hubLayout, hubStage, STAGES, watchStage } from './tv-layout.ts';
import { tvListRows } from './tv-list.ts';

const RUN = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;

function piece(key: string, extra: Partial<TaskPiece> = {}): TaskPiece {
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
    placement: 'shared',
    provider: 'codex',
    model: 'gpt-6',
    builderRunId: null,
    builderName: null,
    status: 'pending',
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
    ...extra,
  };
}

function list(pieces: TaskPiece[]): PieceList {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    taskId: '00000000-0000-4000-8000-0000000000d2',
    version: 1,
    planVersion: null,
    piecesHash: 'hash',
    placement: 'shared',
    placementReason: 'two large pieces',
    status: 'approved',
    integration: null,
    pieces,
    createdAt: '2026-09-26T10:00:00.000Z',
  };
}

function coordinated() {
  return orchestration({
    crew: [
      member({ runId: RUN(1), role: 'coordinator', name: 'Atlas', mode: 'ask' }),
      member({ runId: RUN(2), name: 'Bolt', pieceKey: 'P1', placement: 'shared' }),
      member({
        runId: RUN(3),
        name: 'Rivet',
        pieceKey: 'P2',
        placement: 'worktree',
        status: 'running',
        toolCalls: 2,
      }),
      member({ runId: RUN(4), role: 'critic', name: 'Quill', status: 'queued' }),
    ],
    pieces: list([
      piece('P1', { status: 'landed', builderName: 'Bolt', builderRunId: RUN(2) }),
      piece('P2', {
        status: 'running',
        placement: 'worktree',
        builderName: 'Rivet',
        builderRunId: RUN(3),
        notesQueued: 2,
      }),
      piece('P3', { dependsOn: ['P2'], placement: 'read_only', research: true }),
      piece('P4', { status: 'skipped', placement: 'in_order', builderName: 'Tack' }),
    ]),
  });
}

describe('Agent TV coordinator scene', () => {
  it('puts the coordinator in the hub and one spoke per piece, with the other crew after', () => {
    const current = coordinated();
    const scene = coordinatorScene(current, crewAgents(current))!;
    const [hub, ...spokes] = scene.members;
    expect(hub).toMatchObject({ id: 'jev', name: 'Atlas', title: 'Coordinator' });
    expect(spokes.map((agent) => [agent.name, agent.state, agent.line])).toEqual([
      ['Bolt', 'done', 'landed'],
      ['Rivet', 'working', 'thinking'],
      ['P3', 'queued', 'waiting on P2'],
      ['Tack', 'stopped', 'skipped'],
      ['Quill', 'queued', 'queued for review'],
    ]);
    expect(Object.values(scene.tags).map(pieceTagText)).toEqual([
      'P1 Piece P1, shared tree, landed',
      "P2 Piece P2, Rivet's copy, running, 2 notes queued",
      'P3 Piece P3, read-only, waiting',
      'P4 Piece P4, in order, skipped',
    ]);
    expect(scene.tags[RUN(4)]).toBeUndefined();
    expect(tvCaption(scene.members).lead).toBe('Atlas → Rivet');
  });

  it('leaves a turn without a piece list to the usual stage', () => {
    const plain = orchestration({ crew: [member()] });
    expect(coordinatorScene(plain, crewAgents(plain))).toBeNull();
  });

  it('lists the same piece states, and the pieces that have not started, in the TV list', () => {
    const current = coordinated();
    const scene = coordinatorScene(current, crewAgents(current))!;
    const detail = { runs: [], approvals: [], activity: {} } as unknown as ConversationDetail;
    const rows = tvListRows(detail, current, scene.members, {});
    const pieces = [...rows.running, ...rows.finished]
      .filter((row) => row.piece)
      .map((row) => [row.name, row.piece!.label, row.piece!.state, row.runId !== '']);
    expect(pieces).toEqual(
      expect.arrayContaining([
        ['Bolt', 'P1 · Piece P1 · shared tree · owns 1 file', 'landed', true],
        ['Rivet', "P2 · Piece P2 · Rivet's copy", 'running', true],
        ['P3', 'P3 · Piece P3 · read-only', 'waiting', false],
        ['Tack', 'P4 · Piece P4 · in order', 'skipped', false],
      ]),
    );
    const unstarted = rows.running.find((row) => row.name === 'P3')!;
    expect(unstarted.agentId).toBe('jev');
    expect(rows.running[0]!.role).toBe('Coordinator');
  });
});

describe('Agent TV hub layout', () => {
  const stages = [STAGES.s, STAGES.m, STAGES.l, watchStage({ width: 1440, height: 900 })];

  it('keeps every spoke and its label on stage, in every size', () => {
    for (const base of stages) {
      const stage = hubStage(base);
      for (let count = 1; count <= 9; count += 1) {
        for (const seat of hubLayout(count, stage).seats) {
          expect(seat.x - stage.labelWidth / 2).toBeGreaterThanOrEqual(0);
          expect(seat.x + stage.labelWidth / 2).toBeLessThanOrEqual(stage.width);
          expect(seat.y - stage.crewSize / 2).toBeGreaterThanOrEqual(0);
          expect(seat.y + stage.crewSize / 2 + 62).toBeLessThanOrEqual(stage.height);
        }
      }
    }
  });

  it('keeps every spoke and its label clear of the hub blob', () => {
    for (const base of stages) {
      const stage = hubStage(base);
      for (let count = 1; count <= 9; count += 1) {
        const { jev, seats } = hubLayout(count, stage);
        const hub = {
          left: jev.x - stage.jevSize / 2,
          right: jev.x + stage.jevSize / 2,
          top: jev.y - stage.jevSize / 2,
          bottom: jev.y + stage.jevSize / 2,
        };
        const overlapping = seats.filter(
          (seat) =>
            seat.x + stage.labelWidth / 2 > hub.left &&
            seat.x - stage.labelWidth / 2 < hub.right &&
            seat.y + stage.crewSize / 2 + 62 > hub.top &&
            seat.y - stage.crewSize / 2 < hub.bottom,
        );
        expect(overlapping).toEqual([]);
      }
    }
  });

  it('grows the small stage so a phone still fits the hub and its spokes', () => {
    expect(hubStage(STAGES.s).height).toBeGreaterThan(STAGES.s.height);
    expect(hubStage(STAGES.s).width).toBe(STAGES.s.width);
    expect(hubStage(watchStage({ width: 1440, height: 900 })).height).toBe(680);
  });
});
