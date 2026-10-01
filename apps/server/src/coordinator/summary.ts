import type { TaskPiece } from '@spark-outpost/contracts';
import type { MemberResult } from '../orchestration/session.ts';
import type { Coordination } from './state.ts';

type Reply = Pick<MemberResult, 'role' | 'runId' | 'name' | 'outcome' | 'text' | 'inPlace'>;

const SENTENCE_LIMIT = 160;
const SENTENCE_END = /(?<=[.!?])\s/;
const MARKUP = /^(?:[-*•]\s+|\d+[.)]\s+|>\s*)|\*\*|__|`/g;

function firstSentence(text: string): string | null {
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(MARKUP, '').trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('#'));
  if (!line) return null;
  const sentence = line.split(SENTENCE_END)[0]!.trim();
  return sentence.length > SENTENCE_LIMIT
    ? `${sentence.slice(0, SENTENCE_LIMIT - 1).trimEnd()}…`
    : sentence;
}

function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function belongsTo(piece: TaskPiece, reply: Reply): boolean {
  return reply.runId === piece.builderRunId || reply.name === piece.builderName;
}

function fileList(files: readonly string[]): string {
  return files.length > 0 ? files.map((file) => `\`${file}\``).join(', ') : 'no files';
}

function pieceLine(piece: TaskPiece, replies: readonly Reply[]): string {
  const head = `- ${piece.key} · ${piece.title}${piece.builderName ? ` (${piece.builderName})` : ''}`;
  if (piece.status !== 'landed') {
    return `${head}: ${piece.status}${piece.note ? ` — ${piece.note}` : ''}`;
  }
  const reply = replies.find((candidate) => belongsTo(piece, candidate));
  const what = (reply && firstSentence(reply.text)) ?? piece.goal;
  return `${head}: ${asSentence(what)} Files: ${fileList(piece.filesChanged)}.`;
}

function laterLine(reply: Reply): string | null {
  const sentence = firstSentence(reply.text);
  return sentence ? `- Then ${reply.name}: ${sentence}` : null;
}

export function piecesSummary(
  coordination: Coordination | null | undefined,
  results: readonly Reply[],
): string | null {
  const list = coordination?.list;
  if (!list) return null;
  const replies = results.filter(
    (result) =>
      !result.inPlace &&
      result.outcome === 'succeeded' &&
      (result.role === 'builder' || result.role === 'integrator'),
  );
  const pieceRuns = new Set(list.pieces.map((piece) => piece.builderRunId));
  const lastPiece = replies.findLastIndex((reply) => pieceRuns.has(reply.runId));
  const later = replies
    .slice(lastPiece + 1)
    .filter((reply) => !pieceRuns.has(reply.runId))
    .flatMap((reply) => laterLine(reply) ?? []);
  const built = list.pieces.filter((piece) => !piece.research);
  return [
    `Built in ${built.length} ${built.length === 1 ? 'piece' : 'pieces'}:`,
    ...built.map((piece) => pieceLine(piece, replies.slice(0, lastPiece + 1))),
    ...later,
  ].join('\n');
}
