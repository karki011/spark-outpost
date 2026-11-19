import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONVERSATION_USAGE,
  emptySubagentRecord,
  type ConversationDetail,
} from '@spark-outpost/contracts';
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
    expect(rows[1]).toMatchObject({ text: 'Opus 5.5', detail: 'Plan', action: null });
  });

  it('shows the model and a short mode, with the provider kept in the label', () => {
    const agent = railRows({ ...base, mode: 'Bypass permissions' })[1];
    expect(agent).toMatchObject({
      text: 'Opus 5.5',
      detail: 'Bypass',
      label: 'Agent Claude · Opus 5.5, Bypass permissions',
    });
    expect(railRows({ ...base, mode: 'Workspace access' })[1]?.detail).toBe('Workspace access');
    expect(railRows({ ...base, model: null })[1]?.text).toBe('Claude');
  });

  it('names the mode of a linked chat', () => {
    const linked = railRows({ ...base, repoNames: ['acme-web'] })[1];
    expect(linked?.label).toBe('Agent Claude · Opus 5.5, mode Plan');
  });

  it('names the project, its branch and where the chat works', () => {
    const [project] = railRows({
      ...base,
      repoNames: ['acme-web', 'acme-api'],
      branch: { name: 'spark/fix-dates', worktree: true },
    });
    expect(project).toMatchObject({
      text: 'acme-web +1',
      detail: 'spark/fix-dates',
      label: 'Project acme-web +1, spark/fix-dates · worktree',
    });
  });

  it('counts the instruction files followed and names the first', () => {
    const rows = railRows({ ...base, following: ['CLAUDE.md', 'AGENTS.md'] });
    expect(rows.find((row) => row.id === 'following')).toMatchObject({
      text: 'Following 2',
      detail: 'CLAUDE.md',
      label: 'Following: CLAUDE.md, AGENTS.md',
    });
    expect(ids({ ...base, following: [] })).not.toContain('following');
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
      text: '3 files',
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
    expect(rows.map((row) => row.id)).toEqual(['project', 'agent', 'pr']);
    expect(rows.find((row) => row.id === 'pr')).toMatchObject({
      text: 'PR #7',
      detail: 'Checks failing',
      tone: 'bad',
      label: 'Pull request acme/widgets#7, Draft, checks failing. Opens on GitHub',
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
      label: '3 pull requests. acme/widgets#8 is open, checks failing',
      tone: 'bad',
      action: { kind: 'tab', tab: 'links' },
    });
    expect(row(false)!.action).toEqual({ kind: 'link', href: watch.url });
  });

  it('shows cost and context, keeps tokens in the label, and opens Cost only with a task', () => {
    const usage = { ...EMPTY_CONVERSATION_USAGE, totalTokens: 12_400, costUsd: 0.08 };
    const row = railRows({ ...base, usage, contextPercent: 23, hasTask: true }).at(-1);
    expect(row).toMatchObject({
      id: 'usage',
      text: '$0.08',
      detail: '23% context',
      label: '12.4K tokens · $0.08, 23% context',
      action: { kind: 'tab', tab: 'cost' },
    });
    const free = { ...usage, costUsd: null };
    expect(railRows({ ...base, usage: free }).at(-1)).toMatchObject({
      text: '12.4K tokens',
      detail: null,
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
    expect(crewJob(crew[1]!)).toBe('Builder · Sonnet 5 · Medium · 2 turns');
    expect(crewJob(crew[2]!)).toBe('Critic · Sonnet 5 · Medium');
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
    const view = railCrew(chat('succeeded'));
    expect(names(view)).toEqual(['Claude']);
    expect(crewHeading(view, 'Auto')).toBe('Claude · Auto');
    expect(crewHeading(view, '')).toBe('Claude');
    expect(crewSectionLabel(view)).toBe('Agent');
    expect(crewJob(view[0]!)).toBe('Agent · Sonnet 5 · Medium');
    expect(names(view)).toEqual(names(tvCrew(chat('succeeded'))));
  });

  it('lists the agent while it works', () => {
    expect(names(railCrew(chat('running')))).toEqual(['Claude']);
  });

  it('shows native workers with the lead while running and retains their outcomes when finished', () => {
    const detail = chat('running');
    detail.subagents = {
      [RUN_ID]: [
        {
          ...emptySubagentRecord,
          id: 'builder',
          name: 'Builder',
          task: 'Build UI',
          parentId: null,
          state: 'working',
          step: 'Editing',
          startedAt: 1,
          endedAt: null,
        },
        {
          ...emptySubagentRecord,
          id: 'reviewer',
          name: 'Reviewer',
          task: 'Review UI',
          parentId: null,
          state: 'done',
          step: null,
          startedAt: 1,
          endedAt: 2,
        },
      ],
    };
    const live = railCrew(detail);
    expect(live.map((agent) => [agent.name, agent.state])).toEqual([
      ['Claude', 'thinking'],
      ['Builder', 'working'],
      ['Reviewer', 'done'],
    ]);
    const finished = railCrew({ ...detail, runs: [run({ status: 'succeeded' })] });
    expect(finished.map((agent) => [agent.name, agent.state])).toEqual([
      ['Claude', 'done'],
      ['Builder', 'inactive'],
      ['Reviewer', 'done'],
    ]);
  });

  it('keeps the rows of a stored crew turn', () => {
    const stored = orchestration({
      status: 'succeeded',
      crew: [member({ name: 'Bolt' }), member({ name: 'Hawk', role: 'critic', runId: HAWK })],
    });
    const view = railCrew(chat('succeeded', { [RUN_ID]: stored }));
    expect(names(view)).toEqual(['Jev', 'Bolt', 'Hawk']);
    expect(crewHeading(view, 'Auto')).toBe('Crew · 3 agents');
    expect(crewSectionLabel(view)).toBe('Crew');
  });

  it('shows nothing before the first message', () => {
    const empty = { runs: [], orchestrations: {}, activity: {} } as unknown as ConversationDetail;
    expect(railCrew(empty)).toEqual([]);
  });
});
