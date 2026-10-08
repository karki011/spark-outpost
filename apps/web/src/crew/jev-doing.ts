import {
  isTerminalRunStatus,
  type CrewMember,
  type JevAsk,
  type Orchestration,
} from '@spark-outpost/contracts';

export type JevDoing =
  | { kind: 'models'; count: number | null }
  | { kind: 'model'; pieceKey: string | null }
  | { kind: 'check'; pieceKey: string | null }
  | { kind: 'next' };

export const COORDINATOR_DOING = 'planning the pieces';

const NEXT: JevDoing = { kind: 'next' };
const CHECKS_AFTER: ReadonlySet<CrewMember['role']> = new Set(['builder', 'integrator']);

function settled(member: CrewMember | undefined): boolean {
  return member !== undefined && isTerminalRunStatus(member.status);
}

function afterLastMember(last: CrewMember | undefined): JevDoing {
  if (!settled(last)) return NEXT;
  return CHECKS_AFTER.has(last!.role) ? { kind: 'check', pieceKey: null } : NEXT;
}

function betweenPieces(orchestration: Orchestration): JevDoing {
  const pieces = orchestration.pieces!.pieces;
  const crew = orchestration.crew;
  const running = pieces.filter((piece) => piece.status === 'running');
  const unrouted = running.find((piece) => !crew.some((member) => member.pieceKey === piece.key));
  if (unrouted) return { kind: 'model', pieceKey: unrouted.key };
  const built = running.find((piece) =>
    settled(crew.findLast((member) => member.pieceKey === piece.key)),
  );
  if (built) return { kind: 'check', pieceKey: built.key };
  const waiting = pieces.some((piece) => piece.status === 'pending' || piece.status === 'ready');
  if (running.length > 0 || waiting) return NEXT;
  return afterLastMember(crew.at(-1));
}

function asked(ask: JevAsk, plannedPieces: number | null): JevDoing {
  if (ask.kind === 'models') return { kind: 'models', count: ask.pieces ?? plannedPieces };
  return { kind: 'check', pieceKey: null };
}

export function jevDoing(orchestration: Orchestration, plannedPieces: number | null): JevDoing {
  if (orchestration.jevAsk) return asked(orchestration.jevAsk, plannedPieces);
  if (orchestration.pieces) return betweenPieces(orchestration);
  const last = orchestration.crew.at(-1);
  if (!last) return { kind: 'model', pieceKey: null };
  if (settled(last) && last.role === 'coordinator') return { kind: 'models', count: plannedPieces };
  return afterLastMember(last);
}

function modelsPhrase(count: number | null): string {
  if (count === null) return 'picking models for the pieces';
  if (count === 1) return 'picking a model for 1 piece';
  return `picking models for ${count} pieces`;
}

export function doingPhrase(doing: JevDoing): string {
  switch (doing.kind) {
    case 'models':
      return modelsPhrase(doing.count);
    case 'model':
      return doing.pieceKey ? `picking a model for ${doing.pieceKey}` : 'picking a model';
    case 'check':
      return `checking ${doing.pieceKey ?? 'the change'}`;
    case 'next':
      return 'choosing the next step';
  }
}
