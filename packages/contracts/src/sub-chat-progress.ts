export type SubChatProgress = 'held' | 'working' | 'reported' | 'ended';

export interface SubChatProgressFacts {
  started: boolean;
  waiting: boolean;
  reported: boolean;
  archived: boolean;
}

export interface PlanPiece {
  id: string;
  title: string;
  progress: SubChatProgress;
  waitsFor: readonly string[];
}

type Plan = ReadonlyMap<string, PlanPiece>;

export function subChatProgress(facts: SubChatProgressFacts): SubChatProgress {
  if (facts.archived) return 'reported';
  if (!facts.started) return 'held';
  if (facts.waiting) return 'working';
  return facts.reported ? 'reported' : 'ended';
}

function awaited(piece: PlanPiece, plan: Plan): PlanPiece[] {
  return piece.waitsFor.flatMap((id) => plan.get(id) ?? []);
}

export function canStart(piece: PlanPiece, plan: Plan): boolean {
  if (piece.progress !== 'held') return false;
  return awaited(piece, plan).every((other) => other.progress === 'reported');
}

function isStuck(piece: PlanPiece, plan: Plan, seen: ReadonlySet<string>): boolean {
  if (piece.progress !== 'held' || seen.has(piece.id)) return false;
  const within = new Set(seen).add(piece.id);
  return awaited(piece, plan).some(
    (other) => other.progress === 'ended' || isStuck(other, plan, within),
  );
}

export function heldBehind(piece: PlanPiece, plan: Plan): PlanPiece[] {
  if (piece.progress !== 'held') return [];
  const within = new Set([piece.id]);
  return awaited(piece, plan).filter(
    (other) => other.progress === 'ended' || isStuck(other, plan, within),
  );
}

export function planSettled(pieces: readonly PlanPiece[]): boolean {
  const plan = new Map(pieces.map((piece) => [piece.id, piece]));
  if (pieces.length === 0) return false;
  return pieces.every(
    (piece) =>
      piece.progress === 'reported' ||
      piece.progress === 'ended' ||
      heldBehind(piece, plan).length > 0,
  );
}

function named(pieces: readonly PlanPiece[]): string {
  return pieces.map((piece) => `“${piece.title}”`).join(', ');
}

export function heldReason(piece: PlanPiece, plan: Plan): string | null {
  if (piece.progress !== 'held') return null;
  const behind = heldBehind(piece, plan);
  if (behind.length > 0) {
    const ended = behind.filter((other) => other.progress === 'ended');
    const stuck = behind.filter((other) => other.progress !== 'ended');
    const why = [
      ...(ended.length > 0 ? [`${named(ended)} did not finish`] : []),
      ...(stuck.length > 0 ? [`${named(stuck)} cannot start by itself`] : []),
    ];
    return `Held: ${why.join(' and ')}. Start anyway starts it.`;
  }
  const pending = awaited(piece, plan).filter((other) => other.progress !== 'reported');
  return pending.length > 0 ? `Waits for ${named(pending)}.` : null;
}
