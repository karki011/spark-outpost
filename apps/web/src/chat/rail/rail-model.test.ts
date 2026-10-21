import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION_USAGE, type ConversationDetail } from '@spark-outpost/contracts';
import { crewAgents } from '../../crew/crew-projection.ts';
import { member, orchestration } from '../../crew/test-orchestration.ts';
import { tvCrew } from '../../crew/conversation-crew.ts';
import { RUN_ID, run } from '../../crew/test-run.ts';

const HAWK = '00000000-0000-4000-8000-0000000000a3';
import {
  crewHeading,
  crewSectionLabel,
  crewJob,
  finishedCrew,
  railCrew,
  railRows,
  type RailFacts,
} from './rail-model.ts';

const base: RailFacts = {
  repoNames: [],
  branch: null,
  provider: 'Claude',
  model: 'Opus 5.5',
  mode: 'Plan',
  autonomy: null,
  changes: null,
  watch: null,
  usage: EMPTY_CONVERSATION_USAGE,
  contextPercent: null,
  hasTask: false,
};

const ids = (facts: RailFacts) => railRows(facts).map((row) => row.id);

describe('railRows', () => {
  it('offers Choose project for an unlinked chat and stays quiet about what is unknown', () => {
    const rows = railRows(base);
    expect(rows.map((row) => row.id)).toEqual(['project', 'agent']);
    expect(rows[0]).toMatchObject({
      text: 'Not linked',
      detail: 'Choose project',
      action: { kind: 'project' },
    });
    expect(rows[1]).toMatchObject({ text: 'Claude · Opus 5.5', detail: 'Plan', action: null });
  });

  it('names the mode of a linked chat and reads the no-tools note plainly', () => {
    const linked = railRows({ ...base, repoNames: ['acme-web'] })[1];
    expect(linked?.label).toBe('Agent Claude · Opus 5.5, mode Plan');
    const plain = railRows({ ...base, mode: 'No file tools without a project' })[1];
    expect(plain).toMatchObject({
      detail: 'No file tools without a project',
      label: 'Agent Claude · Opus 5.5, No file tools without a project',
    });
  });

  it('names the project, its branch and where the chat works', () => {
    const [project] = railRows({
      ...base,
      repoNames: ['acme-web', 'acme-api'],
      branch: { name: 'spark/fix-dates', worktree: true },
    });
    expect(project).toMatchObject({
      text: 'acme-web +1',
      detail: 'spark/fix-dates · worktree',
      onBranch: true,
    });
  });

  it('shows Spark autonomy with the user-facing names and opens its setting', () => {
    const rows = railRows({ ...base, repoNames: ['acme-web'], autonomy: 'full-auto' });
    expect(rows.find((row) => row.id === 'autonomy')).toMatchObject({
      text: 'Full auto → PR',
      action: { kind: 'autonomy' },
    });
  });

  it('counts changed files and opens the changes', () => {
    const rows = railRows({
      ...base,
      hasTask: true,
      changes: { files: 3, added: 120, removed: 8 },
    });
    expect(rows.find((row) => row.id === 'changes')).toMatchObject({
      text: '3 files changed',
      counts: { added: 120, removed: 8 },
      action: { kind: 'changes' },
    });
    expect(ids({ ...base, changes: { files: 0, added: 0, removed: 0 } })).not.toContain('changes');
  });

  it('shows checks and a pull request link once the chat has a PR', () => {
    const rows = railRows({
      ...base,
      hasTask: true,
      watch: {
        repo: 'acme/widgets',
        number: 7,
        url: 'https://github.com/acme/widgets/pull/7',
        prState: 'open',
        draft: true,
        checks: 'failing',
      },
    });
    expect(rows.find((row) => row.id === 'checks')).toMatchObject({
      text: 'Checks failing',
      tone: 'bad',
      action: { kind: 'tab', tab: 'tasks' },
    });
    expect(rows.find((row) => row.id === 'pr')).toMatchObject({
      text: 'PR #7',
      detail: 'Draft',
      action: { kind: 'link', href: 'https://github.com/acme/widgets/pull/7' },
    });
  });

  it('counts several pull requests and opens Links to list them', () => {
    const watch = {
      repo: 'acme/widgets',
      number: 8,
      url: 'https://github.com/acme/widgets/pull/8',
      prState: 'open',
      draft: false,
      checks: 'failing',
    } as const;
    const row = (hasTask: boolean) =>
      railRows({ ...base, hasTask, watch, pulls: 3 }).find((entry) => entry.id === 'pr');
    expect(row(true)).toMatchObject({
      text: '3 pull requests',
      detail: '#8 Open',
      label: '3 pull requests. acme/widgets#8 is open',
      action: { kind: 'tab', tab: 'links' },
    });
    expect(row(false)!.action).toEqual({ kind: 'link', href: watch.url });
  });

  it('sums tokens, cost and context, and opens Cost only when there is a task', () => {
    const usage = { ...EMPTY_CONVERSATION_USAGE, totalTokens: 12_400, costUsd: 0.08 };
    const row = railRows({ ...base, usage, contextPercent: 23, hasTask: true }).at(-1);
    expect(row).toMatchObject({
      id: 'usage',
      text: '12.4K tokens · $0.08',
      detail: '23% context',
      action: { kind: 'tab', tab: 'cost' },
    });
    expect(railRows({ ...base, usage, contextPercent: 23 }).at(-1)?.action).toBeNull();
    expect(railRows({ ...base, contextPercent: 5 }).at(-1)).toMatchObject({
      text: '5% context',
      detail: null,
    });
  });
});

describe('the crew of a finished turn', () => {
  const builder = member({ name: 'Bolt' });
  const retry = member({ name: 'Bolt', runId: '00000000-0000-4000-8000-0000000000a2', attempt: 2 });
  const critic = member({
    name: 'Hawk',
    role: 'critic',
    runId: '00000000-0000-4000-8000-0000000000a3',
    status: 'failed',
  });
  const piece = member({
    name: 'Pip',
    runId: '00000000-0000-4000-8000-0000000000a4',
    status: 'running',
  });

  it('keeps its crew, with final states', () => {
    const turn = orchestration({
      status: 'succeeded',
      phase: 'finished',
      crew: [builder, retry, critic],
    });
    const crew = finishedCrew(turn, crewAgents(turn));
    expect(crew.map((agent) => [agent.name, agent.state])).toEqual([
      ['Jev', 'done'],
      ['Bolt', 'done'],
      ['Hawk', 'failed'],
    ]);
    expect(crewHeading(crew, 'Auto')).toBe('Crew · 3 agents');
    expect(crewJob(crew[1]!)).toBe('Builder · Sonnet 5 · medium · 2 turns');
    expect(crewJob(crew[2]!)).toBe('Critic · Sonnet 5 · medium');
    expect(crewJob(crew[0]!)).toBe('Dispatcher · router');
    expect(crew[1]).toMatchObject({ tokens: 24_800, costUsd: 0.062 });
  });

  it('settles a member the turn left unfinished and counts a solo Builder with Jev', () => {
    const stopped = orchestration({ status: 'cancelled', crew: [builder, piece] });
    const crew = finishedCrew(stopped, crewAgents(stopped));
    expect(crew.map((agent) => agent.state)).toEqual(['stopped', 'done', 'stopped']);
    const solo = orchestration({ status: 'succeeded', depth: 'direct', crew: [builder] });
    expect(crewHeading(finishedCrew(solo, crewAgents(solo)), 'Auto')).toBe('Crew · 2 agents');
  });

  it('leaves a turn that is still going as it is', () => {
    const live = orchestration({ status: 'running', crew: [piece] });
    const agents = crewAgents(live);
    expect(finishedCrew(live, agents)).toEqual(agents);
  });
});

describe('the crew the rail shows', () => {
  const names = (agents: readonly { name: string }[]) => agents.map((agent) => agent.name);
  const chat = (status: 'running' | 'succeeded', orchestrations = {}) =>
    ({
      conversation: { latestRun: null },
      runs: [run({ status })],
      orchestrations,
      approvals: [],
      activity: {},
    }) as unknown as ConversationDetail;

  it("lists one row for a finished turn: the chat's agent with its model", () => {
    const view = railCrew(chat('succeeded'), false);
    expect(view.stage).toEqual([]);
    expect(names(view.list)).toEqual(['Claude']);
    expect(crewHeading(view.list, 'Auto')).toBe('Claude · Auto');
    expect(crewHeading(view.list, '')).toBe('Claude');
    expect(crewSectionLabel(view.list)).toBe('Agent');
    expect(crewJob(view.list[0]!)).toBe('Agent · Sonnet 5 · medium');
    expect(names(view.list)).toEqual(names(tvCrew(chat('succeeded'))));
  });

  it('puts the agent on the stage instead of in the list while it works', () => {
    const view = railCrew(chat('running'), true);
    expect(names(view.stage)).toEqual(['Claude']);
    expect(view.list).toEqual([]);
  });

  it('keeps the rows of a stored crew turn', () => {
    const stored = orchestration({
      status: 'succeeded',
      crew: [member({ name: 'Bolt' }), member({ name: 'Hawk', role: 'critic', runId: HAWK })],
    });
    const view = railCrew(chat('succeeded', { [RUN_ID]: stored }), false);
    expect(names(view.list)).toEqual(['Jev', 'Bolt', 'Hawk']);
    expect(crewHeading(view.list, 'Auto')).toBe('Crew · 3 agents');
    expect(crewSectionLabel(view.list)).toBe('Crew');
  });

  it('shows nothing before the first message', () => {
    const empty = { runs: [], orchestrations: {}, activity: {} } as unknown as ConversationDetail;
    expect(railCrew(empty, false)).toEqual({ stage: [], list: [] });
  });
});
