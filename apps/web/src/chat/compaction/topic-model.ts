import type { AssistantTopic } from '@spark-outpost/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function startOfDay(time: number): number {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function dayLabel(time: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAY.format(time);
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? MONTH_DAY : MONTH_DAY_YEAR).format(time);
}

export function topicLabel(topic: AssistantTopic, now: number): string {
  const day = dayLabel(Date.parse(topic.at), now);
  const when = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
  return `${topic.kind === 'topic' ? 'New topic' : 'History cleared'} · ${when}`;
}

export interface TimedTurn {
  runId: string;
  at: string;
}

export interface TopicPlacement {
  before: Map<string, AssistantTopic[]>;
  after: AssistantTopic[];
}

export function placeTopics(
  topics: readonly AssistantTopic[],
  turns: readonly TimedTurn[],
): TopicPlacement {
  const before = new Map<string, AssistantTopic[]>();
  const after: AssistantTopic[] = [];
  for (const topic of topics) {
    const at = Date.parse(topic.at);
    const next = turns.find((turn) => Date.parse(turn.at) > at);
    if (!next) {
      after.push(topic);
      continue;
    }
    before.set(next.runId, [...(before.get(next.runId) ?? []), topic]);
  }
  return { before, after };
}
