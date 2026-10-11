import { describe, expect, it } from 'vitest';
import type {
  ChangeEntry,
  ConversationDetail,
  ConversationSummary,
} from '@spark-outpost/contracts';
import type { StepView } from '../chat/run-projection.ts';
import {
  activityLine,
  activityLines,
  activityText,
  changeFor,
  finishedLine,
  homeSessions,
  quickStartProject,
  runActivity,
  stepCount,
  withChanges,
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

describe('edit rows with line counts', () => {
  const RUN = '00000000-0000-4000-8000-000000000001';
  const entry = (path: string, added: number, removed: number, patch: Partial<ChangeEntry> = {}) =>
    ({
      runId: RUN,
      path,
      change: 'modified',
      added,
      removed,
      shown: 'text',
      ...patch,
    }) as ChangeEntry;
  const entries = [entry('src/billing/invoice.ts', 12, 3), entry('README.md', 1, 0)];

  it('reads like Edited · invoice.ts +12 −3 from the stored change', () => {
    const steps = [step('Read `src/billing/invoice.ts`'), step('Edit `invoice.ts`')];
    const lines = withChanges(activityLines(steps, true), [RUN], entries);
    expect(lines.map(activityText)).toEqual(['Read · invoice.ts', 'Edited · invoice.ts +12 −3']);
    expect(lines[1]!.change).toEqual({
      runId: RUN,
      path: 'src/billing/invoice.ts',
      added: 12,
      removed: 3,
    });
  });

  it('matches absolute, relative and bare names, and only this run', () => {
    expect(changeFor('/Users/ada/app/src/billing/invoice.ts', [RUN], entries)?.added).toBe(12);
    expect(changeFor('billing/invoice.ts', [RUN], entries)?.added).toBe(12);
    expect(changeFor('README.md', [RUN], entries)?.added).toBe(1);
    expect(changeFor('voice.ts', [RUN], entries)).toBeNull();
    expect(changeFor('invoice.ts', ['another-run'], entries)).toBeNull();
  });

  it('stays a plain row when the name is ambiguous, secret, binary or failed', () => {
    const twins = [entry('a/index.ts', 1, 1), entry('b/index.ts', 2, 2)];
    expect(changeFor('index.ts', [RUN], twins)).toBeNull();
    expect(changeFor('a/index.ts', [RUN], twins)?.added).toBe(1);
    expect(changeFor('.env', [RUN], [entry('.env', 4, 0)])).toBeNull();
    const binary = [entry('logo.png', 0, 0, { shown: 'binary', added: null, removed: null })];
    expect(changeFor('logo.png', [RUN], binary)).toBeNull();
    const failed = withChanges(
      [activityLine(step('Edit README.md', 'failed'), 0, true)],
      [RUN],
      entries,
    );
    expect(failed[0]!.change).toBeNull();
    expect(withChanges(activityLines([step('Edit README.md')], true), [], entries)[0]!.change).toBe(
      null,
    );
  });
});

describe('which run the Now card follows', () => {
  const OWNER = '00000000-0000-4000-8000-000000000001';
  const member = (runId: string, status: string, startedAt: string) => ({
    runId,
    status,
    startedAt,
  });
  const detail = (activity: Record<string, string[]>, crew: ReturnType<typeof member>[] = []) =>
    ({
      runs: [{ id: OWNER, status: 'running' }],
      activity: Object.fromEntries(
        Object.entries(activity).map(([id, names]) => [
          id,
          names.map((name) => ({ name, done: true })),
        ]),
      ),
      orchestrations: crew.length > 0 ? { [OWNER]: { crew } } : undefined,
    }) as unknown as ConversationDetail;
  const live = chat('live', 1, { latestRun: run('running') });

  it('follows the chat’s own run when it works alone', () => {
    const found = runActivity(live, detail({ [OWNER]: ['Edit a.ts'] }));
    expect(found.runId).toBe(OWNER);
    expect(found.runIds).toEqual([OWNER]);
    expect(found.steps.map((item) => item.name)).toEqual(['Edit a.ts']);
  });

  it('follows the crew member that is working, then the last one that did', () => {
    const crew = [
      member('builder', 'succeeded', '2026-10-02T12:00:00.000Z'),
      member('reviewer', 'succeeded', '2026-10-02T12:05:00.000Z'),
      member('fixer', 'running', '2026-10-02T12:06:00.000Z'),
    ];
    const steps = {
      [OWNER]: ['Working on a branch'],
      builder: ['Edit a.ts'],
      fixer: ['Read b.ts'],
    };
    expect(runActivity(live, detail(steps, crew)).runId).toBe('fixer');
    const finished = crew.map((item) => ({ ...item, status: 'succeeded' }));
    const quiet = { [OWNER]: ['Working on a branch'], builder: ['Edit a.ts'] };
    const found = runActivity(live, detail(quiet, finished));
    expect(found.runIds).toEqual(['builder', OWNER]);
    expect(runActivity(live, detail({ [OWNER]: ['Working on a branch'] }, finished)).runId).toBe(
      OWNER,
    );
    expect(runActivity(live, undefined).steps).toEqual([]);
  });
});

describe('the finished line', () => {
  const RUN = '00000000-0000-4000-8000-000000000001';
  const message = (role: string, content: string, runId: string | null = RUN) => ({
    role,
    content,
    runId,
  });
  const detail = (messages: ReturnType<typeof message>[]) =>
    ({ messages }) as unknown as ConversationDetail;

  it('is the first plain sentence of the run’s work reply, not of its publish reply', () => {
    const messages = [
      message('user', 'Fix the totals.', null),
      message('assistant', 'From another turn.', 'other-run'),
      message('assistant', '**Fixed** the `total()` rounding. Tests pass.\n\n- details'),
      message('assistant', 'Opened pull request #4.'),
    ];
    expect(finishedLine(detail(messages), RUN)).toBe('Fixed the total() rounding.');
  });

  it('hides secrets and is absent without a reply', () => {
    const leaked = [message('assistant', 'Used sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')];
    expect(finishedLine(detail(leaked), RUN)).not.toContain('sk-ant');
    expect(finishedLine(detail([message('user', 'Hi', null)]), RUN)).toBeNull();
    expect(finishedLine(detail([message('assistant', '```\ncode\n```')]), RUN)).toBeNull();
    expect(finishedLine(undefined, RUN)).toBeNull();
  });
});
