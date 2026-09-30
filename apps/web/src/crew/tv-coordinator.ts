import {
  pieceBoard,
  type ActivityStep,
  type Orchestration,
  type PieceStatus,
  type TaskPiece,
} from '@spark-outpost/contracts';
import { isBusy, isDispatcher, type CrewAgent, type CrewState } from './crew-model.ts';
import { runAgent } from './crew-projection.ts';

export type PieceState = 'waiting' | 'running' | 'landed' | 'skipped' | 'failed';

export interface PieceTag {
  key: string;
  title: string;
  place: string;
  state: PieceState;
  notes: number;
}

export interface CoordinatorScene {
  members: CrewAgent[];
  tags: Record<string, PieceTag>;
}

const PIECE_STATES: Record<PieceStatus, PieceState> = {
  pending: 'waiting',
  ready: 'waiting',
  running: 'running',
  landed: 'landed',
  skipped: 'skipped',
  failed: 'failed',
};

const SETTLED_STATES: Partial<Record<PieceState, CrewState>> = {
  waiting: 'queued',
  landed: 'done',
  skipped: 'stopped',
  failed: 'failed',
};

export const COORDINATOR_TITLE = 'Coordinator';

export function pieceState(status: PieceStatus): PieceState {
  return PIECE_STATES[status];
}

export function shortPlacement(piece: Pick<TaskPiece, 'placement' | 'builderName'>): string {
  if (piece.placement === 'read_only') return 'read-only';
  if (piece.placement === 'shared') return 'shared tree';
  if (piece.placement === 'worktree') {
    return piece.builderName ? `${piece.builderName}'s copy` : 'own copy';
  }
  return 'in order';
}

export function pieceTag(piece: TaskPiece): PieceTag {
  return {
    key: piece.key,
    title: piece.title,
    place: shortPlacement(piece),
    state: pieceState(piece.status),
    notes: piece.notesQueued,
  };
}

function pieceAgentId(key: string): string {
  return `piece-${key}`;
}

export function waitingAgent(piece: TaskPiece, line: string): CrewAgent {
  return {
    id: pieceAgentId(piece.key),
    role: piece.research ? 'scout' : 'builder',
    name: piece.builderName ?? piece.key,
    provider: piece.provider ?? 'claude',
    model: piece.model,
    effort: null,
    state: 'queued',
    line,
    tokens: null,
    costUsd: piece.costUsd,
    costSource: null,
    durationMs: null,
  };
}

function withPieceState(agent: CrewAgent, state: PieceState, status: string): CrewAgent {
  const settled = SETTLED_STATES[state];
  if (settled) return { ...agent, state: settled, line: status };
  const live = isBusy(agent.state) || agent.state === 'waiting' ? agent.state : 'working';
  return { ...agent, state: live };
}

function pieceAgent(
  piece: TaskPiece,
  status: string,
  orchestration: Orchestration,
  activity: Record<string, readonly ActivityStep[]>,
): CrewAgent {
  const member = orchestration.crew.findLast((candidate) => candidate.pieceKey === piece.key);
  const agent = member
    ? runAgent(member, orchestration, activity[member.runId] ?? [])
    : waitingAgent(piece, status);
  return withPieceState(agent, pieceState(piece.status), status);
}

function hubAgent(orchestration: Orchestration, agents: readonly CrewAgent[]): CrewAgent | null {
  const jev = agents.find(isDispatcher);
  if (!jev) return null;
  const coordinator = orchestration.crew.findLast((member) => member.role === 'coordinator');
  if (!coordinator) return { ...jev, title: COORDINATOR_TITLE };
  return {
    ...jev,
    name: coordinator.name,
    provider: coordinator.provider,
    title: COORDINATOR_TITLE,
  };
}

function otherAgents(orchestration: Orchestration, agents: readonly CrewAgent[]): CrewAgent[] {
  const others = new Set(
    orchestration.crew
      .filter((member) => !member.pieceKey && member.role !== 'coordinator')
      .map((member) => member.name),
  );
  return agents.filter((agent) => !isDispatcher(agent) && others.has(agent.name));
}

export function coordinatorScene(
  orchestration: Orchestration,
  agents: readonly CrewAgent[],
  activity: Record<string, readonly ActivityStep[]> = {},
): CoordinatorScene | null {
  const list = orchestration.pieces;
  const hub = list ? hubAgent(orchestration, agents) : null;
  if (!list || !hub) return null;
  const board = pieceBoard(list);
  const tags: Record<string, PieceTag> = {};
  const spokes = list.pieces.map((piece, index) => {
    const agent = pieceAgent(piece, board[index]!.status, orchestration, activity);
    tags[agent.id] = pieceTag(piece);
    return agent;
  });
  return { members: [hub, ...spokes, ...otherAgents(orchestration, agents)], tags };
}

export function pieceTagText(tag: PieceTag): string {
  const notes = tag.notes > 0 ? `, ${tag.notes} ${tag.notes === 1 ? 'note' : 'notes'} queued` : '';
  return `${tag.key} ${tag.title}, ${tag.place}, ${tag.state}${notes}`;
}
