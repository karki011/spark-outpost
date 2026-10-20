import { describe, expect, it } from 'vitest';
import type { AssistantExchange, AssistantHistory } from '@spark-outpost/contracts';
import { askRows, lastExchange } from './ask-history-model.ts';

const NOW = new Date(2026, 9, 20, 15, 0).getTime();

function at(daysAgo: number, hour: number): string {
  const day = new Date(NOW);
  day.setDate(day.getDate() - daysAgo);
  day.setHours(hour, 0, 0, 0);
  return day.toISOString();
}

function exchange(id: string, askedAt: string, extra: Partial<AssistantExchange> = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${id}`,
    question: `q${id}`,
    askedAt,
    runId: null,
    status: 'answered' as const,
    answer: `a${id}`,
    source: null,
    links: [],
    ...extra,
  };
}

function page(exchanges: AssistantExchange[], topics: AssistantHistory['topics'] = []) {
  return { exchanges, topics, older: null };
}

function shape(rows: ReturnType<typeof askRows>) {
  return rows.map((row) => (row.kind === 'exchange' ? row.question : `${row.kind}:${row.label}`));
}

describe('askRows', () => {
  it('puts the oldest first, with a day line and a New topic line that names its day', () => {
    const topic = {
      id: '10000000-0000-4000-8000-000000000000',
      kind: 'topic' as const,
      at: at(0, 8),
    };
    const rows = askRows(
      [
        page([exchange('3', at(0, 9))]),
        page([exchange('1', at(1, 9)), exchange('2', at(1, 10))], [topic]),
      ],
      [],
      [],
      NOW,
    );
    expect(shape(rows)).toEqual(['day:Yesterday', 'q1', 'q2', 'topic:New topic · today', 'q3']);
  });

  it('weaves instant answers and waiting questions in by time, once each', () => {
    const stored = exchange('1', at(0, 9));
    const rows = askRows(
      [page([stored]), page([stored])],
      [
        {
          id: 'live',
          question: 'Who needs me?',
          answer: 'Nothing.',
          links: [],
          at: Date.parse(at(0, 10)),
        },
      ],
      [
        { id: stored.id, question: 'q1', at: Date.parse(at(0, 9)) },
        { id: 'pending', question: 'later?', at: Date.parse(at(0, 11)) },
      ],
      NOW,
    );
    expect(shape(rows)).toEqual(['day:Today', 'q1', 'Who needs me?', 'later?']);
    expect(rows[2]).toMatchObject({ live: true, status: 'answered' });
    expect(lastExchange(rows)).toMatchObject({ question: 'later?', status: 'waiting' });
  });

  it('labels older days by weekday, then by date, and Clear history by name', () => {
    const rows = askRows(
      [
        page(
          [exchange('1', at(40, 9)), exchange('2', at(3, 9))],
          [{ id: '20000000-0000-4000-8000-000000000000', kind: 'cleared', at: at(3, 10) }],
        ),
      ],
      [],
      [],
      NOW,
    );
    expect(shape(rows)).toEqual([
      'day:Sep 10',
      'q1',
      'day:Saturday',
      'q2',
      'topic:History cleared · Saturday',
    ]);
  });
});
