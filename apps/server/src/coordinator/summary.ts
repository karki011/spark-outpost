import type { TaskPiece } from '@spark-outpost/contracts';
import { escaped } from '../orchestration/risk-rules.ts';
import type { MemberResult } from '../orchestration/session.ts';
import type { Coordination } from './state.ts';

type Reply = Pick<MemberResult, 'role' | 'runId' | 'name' | 'outcome' | 'text' | 'inPlace'>;

const SENTENCE_LIMIT = 160;
const SENTENCE_END = /(?<=[.!?])\s/;
const MARKUP = /^(?:[-*•]\s+|\d+[.)]\s+|>\s*)|\*\*|__|`/g;

function withoutVocative(sentence: string, name: string | null): string {
  if (!name) return sentence;
  const who = escaped(name);
  const lead = new RegExp(
    `^(?:(?:hi|hey|hello|ok|okay|sure|done)\\s+)?${who}\\s*[,:!—–-]\\s*`,
    'i',
  );
  const tail = new RegExp(`\\s*,\\s*${who}(?=[.!?…]*$)`, 'i');
  const stripped = sentence.replace(lead, '').replace(tail, '').trim();
  if (!stripped || stripped === sentence) return sentence;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function firstSentence(text: string, name: string | null): string | null {
  const line = text
    .split('\n')
    .map((candidate) => candidate.replace(MARKUP, '').trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('#'));
  if (!line) return null;
  const sentence = withoutVocative(line.split(SENTENCE_END)[0]!.trim(), name);
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

function pieceLine(piece: TaskPiece, replies: readonly Reply[], name: string | null): string {
  const head = `- ${piece.key} · ${piece.title}${piece.builderName ? ` (${piece.builderName})` : ''}`;
  if (piece.status !== 'landed') {
    return `${head}: ${piece.status}${piece.note ? ` — ${piece.note}` : ''}`;
  }
  const reply = replies.find((candidate) => belongsTo(piece, candidate));
  const what = (reply && firstSentence(reply.text, name)) ?? piece.goal;
  return `${head}: ${asSentence(what)} Files: ${fileList(piece.filesChanged)}.`;
}

function laterLine(reply: Reply, name: string | null): string | null {
  const sentence = firstSentence(reply.text, name);
  return sentence ? `- Then ${reply.name}: ${sentence}` : null;
}

export function piecesSummary(
  coordination: Coordination | null | undefined,
  results: readonly Reply[],
  userName: string | null = null,
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
    .flatMap((reply) => laterLine(reply, userName) ?? []);
  const built = list.pieces.filter((piece) => !piece.research);
  return [
    `Built in ${built.length} ${built.length === 1 ? 'piece' : 'pieces'}:`,
    ...built.map((piece) => pieceLine(piece, replies.slice(0, lastPiece + 1), userName)),
    ...later,
  ].join('\n');
}
