import { storyOrder, type SubChatReport, type SubChatStatus } from '@spark-outpost/contracts';
import { recordLine, statusWords } from './report.ts';

export interface WrapUpPiece {
  id: string;
  title: string;
  position: number;
  status: SubChatStatus;
  reason: string | null;
  record: Pick<SubChatReport, 'branch' | 'committed' | 'pushed' | 'pullRequest'> | null;
  stackedOn: string | null;
}

export const WRAP_UP_FROM = 'Spark';

const OPENING =
  'Every sub-chat of this chat has ended or cannot start by itself. Spark wrote this message; the user did not write it.';
const RECORD =
  "What each line says about branches, commits, pushes and pull requests is Spark's own record as it is now: report it as it stands, whatever a sub-chat's report said about committing or pushing.";
const ASK =
  'Reply with a wrap-up for the user: what was done, what failed or was stopped, which sub-chats need them, which pull requests are open and the order to merge them. This is a report and asks for no new work.';

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function quoted(title: string): string {
  return `“${oneLine(title)}”`;
}

function pieceLine(piece: WrapUpPiece, titles: ReadonlyMap<string, string>): string {
  const reason = piece.reason === null ? null : oneLine(piece.reason);
  const stackedOn = piece.stackedOn === null ? undefined : titles.get(piece.stackedOn);
  return [
    `${quoted(piece.title)}: ${statusWords({ status: piece.status, reason })}`,
    ...(piece.record ? [recordLine(piece.record)] : []),
    ...(stackedOn === undefined ? [] : [`stacked on ${quoted(stackedOn)}`]),
  ].join(' · ');
}

function inOrder(pieces: readonly WrapUpPiece[]): WrapUpPiece[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  return storyOrder(
    pieces.map((piece) => ({
      conversationId: piece.id,
      dependsOn: piece.stackedOn !== null && byId.has(piece.stackedOn) ? piece.stackedOn : null,
      position: piece.position,
    })),
  ).flatMap((item) => byId.get(item.conversationId) ?? []);
}

export function mergeOrder(pieces: readonly WrapUpPiece[]): string[] {
  const ids = new Set(pieces.map((piece) => piece.id));
  const bases = new Set(pieces.flatMap((piece) => piece.stackedOn ?? []));
  return inOrder(pieces)
    .filter(
      (piece) => (piece.stackedOn !== null && ids.has(piece.stackedOn)) || bases.has(piece.id),
    )
    .map((piece) => piece.title);
}

function mergeLine(pieces: readonly WrapUpPiece[]): string[] {
  const order = mergeOrder(pieces);
  if (order.length < 2) return [];
  return [`Merge the stacked pull requests in this order: ${order.map(quoted).join(', then ')}.`];
}

export function wrapUpBody(pieces: readonly WrapUpPiece[]): string {
  const titles = new Map(pieces.map((piece) => [piece.id, piece.title]));
  return [
    OPENING,
    ...inOrder(pieces).map((piece) => pieceLine(piece, titles)),
    ...mergeLine(pieces),
    RECORD,
    ASK,
  ].join('\n');
}
