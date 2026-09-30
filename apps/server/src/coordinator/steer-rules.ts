import {
  STEER_ALL,
  STEER_AUTO,
  STEER_COORDINATOR,
  type PieceNoteKind,
  type ProviderId,
  type SteerTarget,
  type TaskPiece,
} from '@spark-outpost/contracts';

export type SteerKind = Exclude<PieceNoteKind, 'merge_main' | 'contract_changed'>;

export interface SteerPlan {
  kind: SteerKind;
  target: typeof STEER_ALL | typeof STEER_COORDINATOR | string;
  body: string;
  provider: ProviderId | null;
}

export type Classified = { ok: true; plan: SteerPlan } | { ok: false; error: string };

const STOP = /^\s*stop(?:\s+(?:the\s+)?(?:task|everything|all))?\s*[.!]?\s*$/i;
const SKIP = /^\s*(?:please\s+)?(?:skip|drop)\b/i;
const ALSO = /^\s*(?:also|and also|plus|add|make sure|don't forget|do not forget)\b[\s,:]*/i;
const USE =
  /\b(?:use|move\s+.*?\bto|switch\s+.*?\bto|give\s+.*?\bto)\s+(claude|codex|z\.?ai|glm)\b/i;

const PROVIDERS: Record<string, ProviderId> = {
  claude: 'claude',
  codex: 'codex',
  zai: 'zai',
  'z.ai': 'zai',
  glm: 'zai',
};

function mentioned(text: string, pieces: readonly TaskPiece[]): TaskPiece[] {
  const word = (name: string) =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`,
      'iu',
    );
  return pieces.filter(
    (piece) =>
      word(piece.key).test(text) ||
      word(piece.title).test(text) ||
      (piece.builderName !== null && word(piece.builderName).test(text)),
  );
}

function kindOf(text: string): { kind: SteerKind; provider: ProviderId | null; body: string } {
  if (STOP.test(text)) return { kind: 'stop', provider: null, body: text.trim() };
  if (SKIP.test(text)) return { kind: 'skip', provider: null, body: text.trim() };
  const use = USE.exec(text);
  if (use) {
    const provider = PROVIDERS[use[1]!.toLowerCase()] ?? null;
    if (provider) return { kind: 'reassign', provider, body: provider };
  }
  if (ALSO.test(text)) {
    const rest = text.replace(ALSO, '').trim();
    return { kind: 'requirement_added', provider: null, body: rest || text.trim() };
  }
  return { kind: 'steer', provider: null, body: text.trim() };
}

function needsOnePiece(kind: SteerKind): boolean {
  return kind === 'skip' || kind === 'reassign';
}

export function classifySteer(
  text: string,
  target: SteerTarget,
  pieces: readonly TaskPiece[],
): Classified {
  const { kind, provider, body } = kindOf(text);
  if (kind === 'stop')
    return { ok: true, plan: { kind, target: STEER_COORDINATOR, body, provider } };
  let chosen: string = target;
  if (target === STEER_AUTO) {
    const named = mentioned(text, pieces);
    chosen = named.length === 1 ? named[0]!.key : STEER_ALL;
  }
  if (chosen !== STEER_ALL && chosen !== STEER_COORDINATOR) {
    if (!pieces.some((piece) => piece.key === chosen)) {
      return { ok: false, error: `There is no piece ${chosen}.` };
    }
  }
  if (needsOnePiece(kind) && (chosen === STEER_ALL || chosen === STEER_COORDINATOR)) {
    return { ok: false, error: 'Say which piece, for example "skip P2" or pick it in To.' };
  }
  return { ok: true, plan: { kind, target: chosen, body, provider } };
}
