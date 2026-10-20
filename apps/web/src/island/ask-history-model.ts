import type {
  AssistantChatLink,
  AssistantExchange,
  AssistantHistory,
} from '@spark-outpost/contracts';
import { dayLabel, startOfDay, topicLabel } from '../chat/compaction/topic-model.ts';

export interface LocalAnswer {
  id: string;
  question: string;
  answer: string;
  links: AssistantChatLink[];
  at: number;
}

export interface PendingAsk {
  id: string;
  question: string;
  at: number;
}

export interface ExchangeRow {
  kind: 'exchange';
  key: string;
  question: string;
  answer: string | null;
  status: AssistantExchange['status'];
  live: boolean;
  source: AssistantChatLink | null;
  links: AssistantChatLink[];
}

export type AskRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'topic'; key: string; label: string }
  | ExchangeRow;

interface Timed {
  at: number;
  row: AskRow;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) seen.set(key(item), item);
  return [...seen.values()];
}

function stored(exchange: AssistantExchange): Timed {
  return {
    at: Date.parse(exchange.askedAt),
    row: {
      kind: 'exchange',
      key: exchange.id,
      question: exchange.question,
      answer: exchange.answer,
      status: exchange.status,
      live: false,
      source: exchange.source,
      links: exchange.links,
    },
  };
}

function local(answer: LocalAnswer): Timed {
  return {
    at: answer.at,
    row: {
      kind: 'exchange',
      key: answer.id,
      question: answer.question,
      answer: answer.answer,
      status: 'answered',
      live: true,
      source: null,
      links: answer.links,
    },
  };
}

function pending(ask: PendingAsk): Timed {
  return {
    at: ask.at,
    row: {
      kind: 'exchange',
      key: ask.id,
      question: ask.question,
      answer: null,
      status: 'waiting',
      live: false,
      source: null,
      links: [],
    },
  };
}

export function askRows(
  pages: readonly AssistantHistory[],
  answers: readonly LocalAnswer[],
  asks: readonly PendingAsk[],
  now: number,
): AskRow[] {
  const exchanges = uniqueBy(
    pages.flatMap((page) => page.exchanges),
    (exchange) => exchange.id,
  );
  const known = new Set(exchanges.map((exchange) => exchange.id));
  const topics = uniqueBy(
    pages.flatMap((page) => page.topics),
    (topic) => topic.id,
  );
  const timed: Timed[] = [
    ...exchanges.map(stored),
    ...topics.map((topic) => ({
      at: Date.parse(topic.at),
      row: { kind: 'topic' as const, key: topic.id, label: topicLabel(topic, now) },
    })),
    ...answers.map(local),
    ...asks.filter((ask) => !known.has(ask.id)).map(pending),
  ].toSorted((a, b) => a.at - b.at);
  const rows: AskRow[] = [];
  let day: number | null = null;
  for (const entry of timed) {
    const entryDay = startOfDay(entry.at);
    if (entryDay !== day) {
      day = entryDay;
      if (entry.row.kind !== 'topic') {
        rows.push({ kind: 'day', key: `day-${entryDay}`, label: dayLabel(entry.at, now) });
      }
    }
    rows.push(entry.row);
  }
  return rows;
}

export function lastExchange(rows: readonly AskRow[]): ExchangeRow | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === 'exchange') return row;
  }
  return null;
}
