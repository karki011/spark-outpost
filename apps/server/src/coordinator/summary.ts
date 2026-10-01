import type { TaskPiece } from '@spark-outpost/contracts';
import { escaped } from '../orchestration/risk-rules.ts';
import type { MemberResult } from '../orchestration/session.ts';
import { pieceCheckText } from './report.ts';
import type { Coordination } from './state.ts';

type Reply = Pick<MemberResult, 'role' | 'runId' | 'name' | 'outcome' | 'text' | 'inPlace'>;

const SUMMARY_LIMIT = 200;
const SENTENCE_END = /(?<=[.!?])\s+/;
const MARKUP = /^(?:[-*•]\s+|\d+[.)]\s+|>\s*)|\*\*|__|`/g;
const LIST_ITEM = /^(?:[-*•]|\d+[.)])\s+/;
const UNFINISHED = /^(?:now,?\s+|next,?\s+|then,?\s+)?(?:let me|let's|i'll|i will|i'm going to)\b/i;
const TESTS_PASS =
  /^(?:(?:all|both|the)\s+)?(?:\d+\s+)?(?:(?:scoped|unit|new)\s+)?(?:tests?|checks?|specs?)(?:\s+(?:now|still|all))?\s+(?:pass(?:es|ed)?|are passing|(?:are|is) green|succeed(?:s|ed)?)\b[^.!?]*[.!]?$/i;
const IS_DONE =
  /^[^.!?]{0,60}\s(?:is|are)\s+(?:now\s+)?(?:done|finished|complete|ready|in place)[.!]?$/i;
const DONE = /^done[.!]?$/i;
const SKIP_NOTE =
  /^(?:skipped|not skipped|nothing (?:was |is )?skipped|nothing else (?:was )?skipped|left out|not done|still to do|left for later|what's left|not included|i (?:skipped|didn't|did not|left out)|i haven't)\b/i;
const STATUS_ONLY = [TESTS_PASS, IS_DONE, DONE, SKIP_NOTE];

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

function paragraphText(paragraph: string): string | null {
  const lines = paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0 || lines.some((line) => line.startsWith('```'))) return null;
  const prose = lines.filter((line) => !line.startsWith('#'));
  if (prose.length === 0 || prose.every((line) => LIST_ITEM.test(line))) return null;
  return prose.map((line) => line.replace(MARKUP, '').trim()).join(' ');
}

function telling(sentence: string): boolean {
  return !UNFINISHED.test(sentence) && !STATUS_ONLY.some((status) => status.test(sentence));
}

function capped(sentences: readonly string[]): string {
  const [first, ...rest] = sentences;
  if (first!.length > SUMMARY_LIMIT) return `${first!.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
  let text = first!;
  for (const sentence of rest) {
    if (text.length + 1 + sentence.length > SUMMARY_LIMIT) break;
    text = `${text} ${sentence}`;
  }
  return text;
}

function paragraphSummary(text: string, name: string | null): string | null {
  const sentences = text
    .split(SENTENCE_END)
    .map((sentence) => withoutVocative(sentence.trim(), name))
    .filter((sentence) => sentence !== '' && telling(sentence));
  if (sentences.length === 0) return null;
  const summary = capped(sentences);
  return /:\W*$/.test(summary) ? null : summary;
}

function finalSummary(text: string, name: string | null): string | null {
  const paragraphs = text.split(/\n\s*\n/).reverse();
  for (const paragraph of paragraphs) {
    const prose = paragraphText(paragraph);
    const summary = prose && !SKIP_NOTE.test(prose) ? paragraphSummary(prose, name) : null;
    if (summary) return summary;
  }
  return null;
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
  const what = (reply && finalSummary(reply.text, name)) ?? piece.goal;
  const files = `Files: ${fileList(piece.filesChanged)}.`;
  return `${head}: ${asSentence(what)} ${files} Scoped check: ${pieceCheckText(piece)}.`;
}

function laterLine(reply: Reply, name: string | null): string | null {
  const summary = finalSummary(reply.text, name);
  return summary ? `- Then ${reply.name}: ${asSentence(summary)}` : null;
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
