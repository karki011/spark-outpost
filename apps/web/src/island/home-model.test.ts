import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { StepView } from '../chat/run-projection.ts';
import {
  activityLine,
  activityLines,
  activityText,
  homeSessions,
  quickStartProject,
  stepCount,
} from './home-model.ts';

function chat(id: string, minutesAgo: number, patch: Partial<ConversationSummary> = {}) {
  return {
    id,
    title: `Chat ${id}`,
    updatedAt: new Date(Date.UTC(2026, 9, 2, 12, 0) - minutesAgo * 60_000).toISOString(),
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...patch,
  } satisfies ConversationSummary;
}

const run = (status: string) =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
  }) as ConversationSummary['latestRun'];

const step = (name: string, status: StepView['status'] = 'done'): StepView => ({ name, status });
const text = (name: string, status: StepView['status'] = 'done', live = true) =>
  activityText(activityLine(step(name, status), 0, live));

describe('the Home card’s most relevant session', () => {
  it('puts what needs you first, then what runs, newest first in each', () => {
    const chats = [
      chat('done', 0, { latestRun: run('succeeded') }),
      chat('old-run', 9, { latestRun: run('running') }),
      chat('new-run', 2, { latestRun: run('queued') }),
      chat('ask', 30, { needsInput: true, latestRun: run('awaiting_approval') }),
      chat('archived', 0, { needsInput: true, archivedAt: '2026-10-01T00:00:00.000Z' }),
    ];
    expect(homeSessions(chats).map((item) => item.id)).toEqual(['ask', 'new-run', 'old-run']);
  });

  it('falls back to the most recent chat when nothing is live, and to nothing at all', () => {
    const chats = [
      chat('older', 50, { latestRun: run('failed') }),
      chat('newest', 3, { latestRun: run('succeeded') }),
    ];
    expect(homeSessions(chats).map((item) => item.id)).toEqual(['newest']);
    expect(homeSessions([])).toEqual([]);
  });

  it('keeps the pager to five live sessions', () => {
    const chats = Array.from({ length: 7 }, (_, index) =>
      chat(`run-${index}`, index, { latestRun: run('running') }),
    );
    expect(homeSessions(chats)).toHaveLength(5);
  });
});

describe('the quick start project', () => {
  const project = (id: string, name: string) =>
    ({ id, name }) as Parameters<typeof quickStartProject>[1][number];

  it('offers the project of the latest chat, then any project, then nothing', () => {
    const projects = [project('p1', 'Alpha'), project('p2', 'Billing')];
    const chats = [chat('old', 40, { projectIds: ['p1'] }), chat('new', 2, { projectIds: ['p2'] })];
    expect(quickStartProject(chats, projects)?.name).toBe('Billing');
    expect(quickStartProject([chat('loose', 1)], projects)?.name).toBe('Alpha');
    expect(quickStartProject([], [])).toBeNull();
  });
});

describe('the step counter', () => {
  it('counts the step in progress and hides when there is no real checklist', () => {
    expect(stepCount({ done: 1, active: 1, total: 4 })).toEqual({ current: 2, total: 4 });
    expect(stepCount({ done: 4, active: 0, total: 4 })).toEqual({ current: 4, total: 4 });
    expect(stepCount({ done: 0, active: 0, total: 1 })).toBeNull();
    expect(stepCount(null)).toBeNull();
  });
});

describe('activity lines', () => {
  it('turns tool steps into a verb and a file name', () => {
    expect(text('Read `src/billing.ts`')).toBe('Read · billing.ts');
    expect(text('Edit `/Users/ada/work/app/src/billing.ts`', 'open')).toBe('Editing · billing.ts');
    expect(text('Reading /Users/ada/notes/plan.md:12', 'open')).toBe('Reading · plan.md');
    expect(text('grep "invoice" src/lib', 'done')).toBe('Searched · lib');
    expect(text('Fetch https://example.com/docs?token=abc')).toBe('Searched · example.com');
    expect(text('Thinking', 'open')).toBe('Thinking');
  });

  it('shows commands by their first words only and never their secrets', () => {
    expect(text('`pnpm test --filter web`', 'open')).toBe('Running · pnpm test');
    expect(text('`API_KEY=abc123 node scripts/deploy.mjs`')).toBe('Ran · node deploy.mjs');
    const leaked = text('Read sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(leaked).not.toContain('sk-ant');
    expect(leaked).toContain('•••');
  });

  it('keeps a plain step short and marks finished or failed work', () => {
    expect(text('Reading your message', 'open')).toBe('Reading · your message');
    expect(text('Applying the database migration for invoices and refunds')).toMatch(
      /^Edited · .{1,28}$/,
    );
    expect(activityLine(step('Run tests', 'failed'), 0, true).state).toBe('failed');
    expect(activityLine(step('Read a.ts', 'open'), 0, false).state).toBe('done');
    expect(text('Compacting the chat')).toBe('Compacting the chat');
  });

  it('keeps the last three steps with stable keys so new ones can slide in', () => {
    const steps = ['Read a.ts', 'Read b.ts', 'Edit c.ts', 'Run tests'].map((name) => step(name));
    const lines = activityLines(steps, true);
    expect(lines.map((line) => line.key)).toEqual(['1', '2', '3']);
    expect(lines.map(activityText)).toEqual(['Read · b.ts', 'Edited · c.ts', 'Ran · tests']);
  });
});
