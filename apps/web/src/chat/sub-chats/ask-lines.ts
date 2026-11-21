import {
  exchangesLine,
  fromChatLine,
  sentToChatLine,
  type ChatAsk,
  type SubChatReport,
} from '@spark-outpost/contracts';

export interface AskLine {
  id: string;
  side: 'sent' | 'received';
  text: string;
  body: string;
  note: string | null;
  report: SubChatReport | null;
}

export interface AskLineGroup {
  key: string;
  chat: string;
  summary: string | null;
  lines: AskLine[];
}

const NOTICE_PREFIX = 'No reply: ';
const NOT_YOURS = 'not your message';

function isNotice(ask: ChatAsk, asks: readonly ChatAsk[]): boolean {
  if (ask.kind !== 'reply' || !ask.body.startsWith(NOTICE_PREFIX)) return false;
  const original = asks.find((candidate) => candidate.id === ask.replyTo);
  return original ? original.state === 'no_reply' : true;
}

function receivedText(ask: ChatAsk, asks: readonly ChatAsk[]): string {
  const chat = ask.from.title;
  if (isNotice(ask, asks)) return `No reply from ${chat}: ${ask.body.slice(NOTICE_PREFIX.length)}`;
  if (ask.kind === 'wrap_up') return 'Wrap-up from Spark';
  if (ask.kind === 'report') return `Report from ${chat}`;
  const line = fromChatLine(chat, ask.body);
  return ask.kind === 'reply' ? `Reply ${line.replace(/^From/, 'from')}` : line;
}

export function receivedLabel(ask: ChatAsk, asks: readonly ChatAsk[]): string {
  return `${receivedText(ask, asks)} · ${NOT_YOURS}`;
}

export function turnStartAsk(
  asks: readonly ChatAsk[] | undefined,
  chatId: string,
  userMessageId: string | null | undefined,
): ChatAsk | null {
  if (!userMessageId) return null;
  return asks?.find((ask) => ask.id === userMessageId && ask.to.id === chatId) ?? null;
}

function sentLine(ask: ChatAsk): AskLine {
  return {
    id: ask.id,
    side: 'sent',
    text: sentToChatLine(ask.to.title, ask.body, ask.state),
    body: ask.body,
    note: ask.state === 'no_reply' ? ask.noReplyReason : null,
    report: null,
  };
}

function receivedLine(ask: ChatAsk, asks: readonly ChatAsk[]): AskLine {
  return {
    id: ask.id,
    side: 'received',
    text: receivedLabel(ask, asks),
    body: ask.body,
    note: null,
    report: ask.kind === 'report' ? ask.report : null,
  };
}

interface Placed {
  key: string;
  chat: string;
  round: boolean;
  line: AskLine;
}

function placedIn(
  ask: ChatAsk,
  asks: readonly ChatAsk[],
  chatId: string,
  runIds: ReadonlySet<string>,
): Placed | null {
  const sent = ask.from.id === chatId && ask.kind === 'message';
  if (sent && ask.fromRunId !== null && runIds.has(ask.fromRunId)) {
    return { key: ask.to.id, chat: ask.to.title, round: true, line: sentLine(ask) };
  }
  const steered = ask.to.id === chatId && ask.deliveredAs === 'steer';
  if (steered && ask.runId !== null && runIds.has(ask.runId)) {
    return {
      key: ask.from.id ?? `gone:${ask.from.title}`,
      chat: ask.from.title,
      round: ask.kind !== 'reply',
      line: receivedLine(ask, asks),
    };
  }
  return null;
}

export function turnAskLines(
  asks: readonly ChatAsk[] | undefined,
  chatId: string,
  runIds: readonly string[],
): AskLineGroup[] {
  if (!asks || asks.length === 0) return [];
  const inTurn = new Set(runIds);
  const groups = new Map<string, { chat: string; rounds: number; lines: AskLine[] }>();
  for (const ask of asks) {
    const placed = placedIn(ask, asks, chatId, inTurn);
    if (!placed) continue;
    const group = groups.get(placed.key) ?? { chat: placed.chat, rounds: 0, lines: [] };
    group.rounds += placed.round ? 1 : 0;
    group.lines.push(placed.line);
    groups.set(placed.key, group);
  }
  return [...groups].map(([key, group]) => ({
    key,
    chat: group.chat,
    summary: group.rounds > 1 ? exchangesLine(group.rounds, group.chat) : null,
    lines: group.lines,
  }));
}
