import type {
  ConversationDetail,
  MemberMessage,
  Message,
  PieceList,
  Run,
  TaskPiece,
} from '@spark-outpost/contracts';
import { checkpoint, member, orchestration } from '../../crew/test-orchestration.ts';

const CHAT = '00000000-0000-4000-8000-000000000002';
export const TURN = '00000000-0000-4000-8000-000000000001';
const ATLAS = '00000000-0000-4000-8000-0000000000a0';
export const BOLT = '00000000-0000-4000-8000-0000000000a1';
const RIVET = '00000000-0000-4000-8000-0000000000a2';
const ANSWER = '00000000-0000-4000-8000-0000000000a3';
export const CLOSING_REPLY = 'Done: the store and the view are in. Checks passed.';
const STEER = '00000000-0000-4000-8000-0000000000e1';

function piece(key: string, title: string, builderRunId: string): TaskPiece {
  return {
    id: `00000000-0000-4000-8000-0000000000f${key.slice(1)}`,
    key,
    title,
    goal: title,
    owns: [`${title.toLowerCase()}.ts`],
    reads: [],
    dependsOn: [],
    contract: null,
    contractVersion: 1,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 20_000,
    placement: 'shared',
    provider: 'claude',
    model: 'sonnet-5',
    builderRunId,
    builderName: null,
    status: 'landed',
    attempts: 1,
    fixTurns: 0,
    filesChanged: [`${title.toLowerCase()}.ts`],
    violations: [],
    check: 'passed',
    costUsd: 0.03,
    landedAt: '2026-09-26T10:04:00.000Z',
    note: null,
    notesQueued: 0,
    pickNote: null,
  };
}

const PIECES: PieceList = {
  id: '00000000-0000-4000-8000-0000000000f0',
  taskId: '00000000-0000-4000-8000-0000000000f9',
  version: 1,
  planVersion: null,
  piecesHash: 'hash',
  placement: 'shared',
  placementReason: 'Jev: 2 pieces · P1 Store, shared tree · P2 View, shared tree',
  status: 'approved',
  integration: null,
  pieces: [piece('P1', 'Store', BOLT), piece('P2', 'View', RIVET)],
  createdAt: '2026-09-26T10:02:30.000Z',
};

function reply(id: string, runId: string, content: string, createdAt: string): Message {
  return {
    id,
    role: 'assistant',
    runId,
    content,
    createdAt,
    attachments: [],
  } as unknown as Message;
}

const STEERED: MemberMessage = {
  id: STEER,
  runId: BOLT,
  body: 'Use a Map for the store',
  urgency: 'next',
  status: 'delivered',
  messageId: null,
  createdAt: '2026-09-26T10:03:10.000Z',
  deliveredAt: '2026-09-26T10:03:12.000Z',
};

function turnOrchestration(status: Run['status']) {
  const done = status !== 'running';
  const builder = (runId: string, name: string, pieceKey: string) =>
    member({
      runId,
      name,
      pieceKey,
      placement: 'shared',
      stepIndex: 1,
      status: done ? 'succeeded' : 'running',
      finishedAt: done ? '2026-09-26T10:03:38.000Z' : null,
    });
  return orchestration({
    status,
    phase: done ? 'finished' : 'building',
    crew: [
      member({
        runId: ATLAS,
        role: 'coordinator',
        name: 'Atlas',
        mode: 'ask',
        startedAt: '2026-09-26T10:02:10.000Z',
        finishedAt: '2026-09-26T10:02:40.000Z',
      }),
      builder(BOLT, 'Bolt', 'P1'),
      builder(RIVET, 'Rivet', 'P2'),
    ],
    answers: [
      member({
        runId: ANSWER,
        role: 'builder',
        name: 'Bolt',
        answers: STEER,
        startedAt: '2026-09-26T10:03:12.000Z',
      }),
    ],
    checkpoints: [
      checkpoint(
        { kind: 'clarify', question: 'Which store?' },
        {
          runId: BOLT,
          status: 'allowed',
          decidedBy: 'user',
          decidedAt: '2026-09-26T10:03:20.000Z',
          createdAt: '2026-09-26T10:03:15.000Z',
        },
      ),
    ],
    pieces: PIECES,
    totals: {
      runs: 3,
      tokens: 37_200,
      costUsd: 0.09,
      costSource: 'reported',
      durationMs: 98_000,
      toolCalls: 12,
      jevCalls: 1,
      jevTokens: 900,
      jevCostUsd: 0.0001,
      byRole: [],
      byModel: [],
    },
  });
}

export function crewTurn(status: Run['status']) {
  const run = {
    id: TURN,
    conversationId: CHAT,
    parentRunId: null,
    status,
    mode: 'do',
    provider: 'claude',
    category: null,
    snapshot: null,
    revertedAt: null,
  } as unknown as Run;
  const stored = turnOrchestration(status);
  const detail = {
    conversation: { id: CHAT },
    messages: [
      reply('m0', ATLAS, 'Here is the split.', '2026-09-26T10:02:40.000Z'),
      reply('m1', BOLT, 'Store built with a Map.', '2026-09-26T10:03:38.000Z'),
      reply('m2', RIVET, 'View renders the store.', '2026-09-26T10:03:38.000Z'),
      reply('m3', TURN, CLOSING_REPLY, '2026-09-26T10:04:00.000Z'),
    ],
    runs: [run],
    activity: {},
    tasks: [],
    approvals: [],
    orchestrations: { [TURN]: stored },
    plans: {
      saved: [],
      lines: [{ runId: TURN, unit: 'pieces', items: 2, planId: null, version: null }],
    },
    memberMessages: [STEERED],
  } as unknown as ConversationDetail;
  return { run, detail, orchestration: stored };
}
