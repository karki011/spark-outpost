import type { RecapTotals } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import { ellipsize, oneLine } from '../digest/text.ts';
import type {
  RecapChatRow,
  RecapPullRow,
  RecapRows,
  RecapTicketRow,
} from '../persistence/recap-facts.ts';

const TITLE_CHARS = 120;
const REPLY_CHARS = 300;

export type RecapFactKind = 'chat' | 'pull' | 'ticket';

export interface RecapFact {
  id: string;
  kind: RecapFactKind;
  data: Record<string, unknown>;
  refs: string[];
  url: string | null;
  chatId: string | null;
  waitingOnYou: boolean;
}

export interface RecapFacts {
  facts: RecapFact[];
  totals: RecapTotals;
}

function clip(text: string, max: number): string {
  return ellipsize(oneLine(redactText(text)), max);
}

function tail(text: string, max: number): string {
  const clean = oneLine(redactText(text));
  return clean.length <= max ? clean : `…${clean.slice(clean.length - max + 1).trimStart()}`;
}

function chatFact(row: RecapChatRow, index: number): RecapFact {
  return {
    id: `c${index + 1}`,
    kind: 'chat',
    data: {
      title: clip(row.title, TITLE_CHARS),
      ...(row.project ? { project: clip(row.project, TITLE_CHARS) } : {}),
      turnsFinished: row.turns,
      ...(row.failed > 0 ? { turnsFailed: row.failed } : {}),
      ...(row.kept > 0 ? { changesKept: row.kept } : {}),
      ...(row.files_changed > 0 ? { filesChanged: row.files_changed } : {}),
      ...(row.waiting_on ? { waitingOnYou: clip(row.waiting_on, TITLE_CHARS) } : {}),
      ...(row.last_reply ? { lastReply: tail(row.last_reply, REPLY_CHARS) } : {}),
    },
    refs: [],
    url: null,
    chatId: row.id,
    waitingOnYou: row.waiting_on !== null,
  };
}

function pullState(row: RecapPullRow): string {
  if (row.pr_state === 'merged') return 'merged';
  if (row.draft) return 'open draft';
  if (row.review === 'changes_requested') return 'open, changes requested';
  if (row.review === 'approved') return 'open, approved';
  return 'open, waiting for review';
}

function pullFact(row: RecapPullRow, index: number): RecapFact {
  return {
    id: `p${index + 1}`,
    kind: 'pull',
    data: {
      number: `#${row.number}`,
      repo: `${row.owner}/${row.repo}`,
      ...(row.title ? { title: clip(row.title, TITLE_CHARS) } : {}),
      state: pullState(row),
      ...(row.pr_state === 'open' && row.checks !== 'none' ? { checks: row.checks } : {}),
      openedOn: row.created_at.toISOString().slice(0, 10),
    },
    refs: [`#${row.number}`],
    url: row.url,
    chatId: row.conversation_id,
    waitingOnYou: false,
  };
}

function ticketFact(row: RecapTicketRow, index: number): RecapFact {
  return {
    id: `t${index + 1}`,
    kind: 'ticket',
    data: {
      key: row.ticket_key,
      ...(row.title ? { title: clip(row.title, TITLE_CHARS) } : {}),
      ...(row.status ? { status: row.status } : {}),
      thisWeek: row.actions,
    },
    refs: [row.ticket_key],
    url: row.url,
    chatId: row.conversation_id,
    waitingOnYou: false,
  };
}

export function buildRecapFacts(rows: RecapRows): RecapFacts {
  const facts = [
    ...rows.chats.map(chatFact),
    ...rows.pulls.map(pullFact),
    ...rows.tickets.map(ticketFact),
  ];
  return {
    facts,
    totals: {
      chats: rows.chats.length,
      merged: rows.pulls.filter((pull) => pull.pr_state === 'merged').length,
      open: rows.pulls.filter((pull) => pull.pr_state === 'open').length,
      tickets: rows.tickets.length,
    },
  };
}
