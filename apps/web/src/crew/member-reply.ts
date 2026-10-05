import { fencedPiecesBlock, PIECES_FENCE } from '@spark-outpost/contracts';
import { withoutClarifyBlock } from '../chat/markdown/markdown-blocks.ts';

export interface PiecesNotice {
  state: 'writing' | 'ready' | 'unreadable';
  count: number;
}

export interface MemberReply {
  before: string;
  after: string;
  notice: PiecesNotice | null;
}

interface Candidate {
  start: number;
  end: number;
  tagged: boolean;
  body: string;
  closed: boolean;
}

const OPEN_FENCE = /```([\w-]*)[^\n]*(?:\n([\s\S]*))?$/;
const PIECE_KEY = /"key"\s*:/g;
const PIECES_ROLE = 'coordinator';

function openFence(text: string, from: number): Candidate | null {
  const match = OPEN_FENCE.exec(text.slice(from));
  if (!match) return null;
  return {
    start: from + match.index,
    end: text.length,
    tagged: match[1] === PIECES_FENCE,
    body: match[2] ?? '',
    closed: false,
  };
}

function bareJson(text: string): Candidate | null {
  const body = text.trimStart();
  if (!body.startsWith('{')) return null;
  return {
    start: text.length - body.length,
    end: text.length,
    tagged: false,
    body,
    closed: false,
  };
}

function couldBePieces(candidate: Candidate | null): candidate is Candidate {
  if (!candidate) return false;
  const body = candidate.body.trim();
  return candidate.tagged || body.startsWith('{') || (!candidate.closed && body === '');
}

function piecesCandidate(text: string): Candidate | null {
  const fenced = fencedPiecesBlock(text);
  const closed = fenced ? { ...fenced, closed: true } : null;
  if (closed?.tagged) return closed;
  const open = openFence(text, closed?.end ?? 0);
  if (couldBePieces(open)) return open;
  if (couldBePieces(closed)) return closed;
  return closed || open ? null : bareJson(text);
}

function parsedCount(body: string): number | null {
  try {
    const block: unknown = JSON.parse(body.trim());
    const pieces =
      typeof block === 'object' && block !== null ? (block as { pieces?: unknown }).pieces : null;
    return Array.isArray(pieces) && pieces.length > 0 ? pieces.length : null;
  } catch {
    return null;
  }
}

function noticeFor(candidate: Candidate, streaming: boolean): PiecesNotice {
  const count = parsedCount(candidate.body);
  if (count !== null) return { state: 'ready', count };
  if (!streaming) return { state: 'unreadable', count: 0 };
  return { state: 'writing', count: candidate.body.match(PIECE_KEY)?.length ?? 0 };
}

export function memberReply(role: string | null, text: string, streaming: boolean): MemberReply {
  const candidate = role === PIECES_ROLE ? piecesCandidate(text) : null;
  if (!candidate) return { before: text, after: '', notice: null };
  return {
    before: text.slice(0, candidate.start).trimEnd(),
    after: text.slice(candidate.end).trim(),
    notice: noticeFor(candidate, streaming),
  };
}

function pieceCount(count: number): string {
  return count === 1 ? '1 piece' : `${count} pieces`;
}

export function piecesNoticeText(notice: PiecesNotice): string {
  if (notice.state === 'ready') return `Split the work into ${pieceCount(notice.count)}.`;
  if (notice.state === 'unreadable') return 'The piece list could not be read.';
  const sofar = notice.count > 0 ? ` ${pieceCount(notice.count)} so far.` : '';
  return `Splitting the work into pieces…${sofar}`;
}

export function memberReplyText(role: string | null, text: string, streaming: boolean): string {
  const reply = memberReply(role, text, streaming);
  const notice = reply.notice ? piecesNoticeText(reply.notice) : '';
  return withoutClarifyBlock([reply.before, notice, reply.after].filter(Boolean).join('\n\n'));
}
