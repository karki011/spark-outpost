import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentRoleLabel, type AgentRole, type InvolvementLevel } from '@spark-outpost/contracts';
import { conversationAuditRuns, summarizeAudit } from '../src/persistence/audit-summary.ts';
import { getTaskDetail } from '../src/persistence/task-views.ts';
import {
  LEVELS,
  QUESTION,
  RISKY,
  SCENARIOS,
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SCOUT: AgentRole = 'scout';
const BUILDER: AgentRole = 'builder';
const CRITIC: AgentRole = 'critic';

interface Expectation {
  crew: AgentRole[];
  asked: string[];
}

const asksEdits = (crew: AgentRole[]): Record<InvolvementLevel, Expectation> => ({
  'hands-off': { crew, asked: [] },
  'full-auto': { crew, asked: [] },
});

const EXPECTED: Record<string, Record<InvolvementLevel, Expectation>> = {
  question: {
    'hands-off': { crew: ['scout'], asked: [] },
    'full-auto': { crew: ['scout'], asked: [] },
  },
  trivial: asksEdits([BUILDER]),
  normal: asksEdits([BUILDER]),
  complex: asksEdits([BUILDER]),
  risky: {
    'hands-off': { crew: [SCOUT, BUILDER, CRITIC], asked: ['plan'] },
    'full-auto': { crew: [SCOUT, BUILDER, CRITIC], asked: ['plan'] },
  },
};

let t: TestDb;
let harness: Harness;

beforeAll(async () => {
  t = await createTestDb();
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [] }));
}, 30_000);

afterAll(async () => {
  await harness.stop();
  await t.cleanup();
});

async function runLevel(
  scenario: Scenario,
  level: InvolvementLevel,
  routing: 'auto' | 'pinned' = 'auto',
  model = 'sonnet',
) {
  const root = await gitRepo();
  try {
    const { conversationId, runId } = await startScenario(t, root, scenario, level, routing, model);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    const notes = await readFile(join(root, 'notes.txt'), 'utf8');
    const audit = summarizeAudit(
      conversationId,
      (await conversationAuditRuns(t.db, conversationId))!,
    );
    return { runId, asked, orchestration, notes, audit };
  } finally {
    await removeRepo(root);
  }
}

describe.each(SCENARIOS)('$id', (scenario) => {
  it('takes the right path, asks the right checkpoints and records every decision at each level', async () => {
    const outcomes = await Promise.all(LEVELS.map((level) => runLevel(scenario, level)));
    for (const [index, level] of LEVELS.entries()) {
      const { runId, asked, orchestration, notes, audit } = outcomes[index]!;
      const expected = EXPECTED[scenario.id]![level];
      const context = `${scenario.id} at ${level}`;
      expect(orchestration.status, context).toBe('succeeded');
      expect(
        orchestration.crew.map((member) => member.role),
        context,
      ).toEqual(expected.crew);
      expect(
        asked.map((approval) => approval.kind),
        context,
      ).toEqual(expected.asked);
      expect(
        orchestration.crew.every((member) => member.status === 'succeeded'),
        context,
      ).toBe(true);

      const kept = orchestration.checkpoints.filter(
        (approval) => approval.kind === 'accept' && approval.decidedBy === 'level',
      );
      const answersOnly = expected.crew.every((role) => role === SCOUT);
      const keptBy = answersOnly ? [] : [level];
      expect(
        kept.map((approval) => approval.payload.checkpoint?.keptBy),
        context,
      ).toEqual(keptBy);
      if (level === 'hands-off' && keptBy.length > 0) {
        expect(kept[0]!.reason, context).toContain('Kept automatically');
      }

      const builders = expected.crew.filter((role) => role === BUILDER).length;
      expect(notes.split('\n').filter((line) => line.startsWith('step')).length, context).toBe(
        builders,
      );
      if (expected.crew[0] === 'scout') expect(orchestration.crew[0]!.runId, context).toBe(runId);
      else expect(orchestration.crew[0]!.runId, context).not.toBe(runId);

      const kinds = orchestration.decisions.map((decision) => decision.kind);
      expect(
        kinds.filter((kind) => kind === 'intake'),
        context,
      ).toHaveLength(1);
      expect(
        kinds.filter((kind) => kind === 'route'),
        context,
      ).toHaveLength(expected.crew.length);
      expect(
        kinds.filter((kind) => !['intake', 'route', 'policy', 'verify'].includes(kind)),
        context,
      ).toEqual([]);

      const tokens = orchestration.crew.reduce((total, member) => total + (member.tokens ?? 0), 0);
      expect(orchestration.totals.tokens, context).toBe(tokens);
      expect(orchestration.totals.runs, context).toBe(expected.crew.length);
      const roles = new Set(expected.crew);
      expect(orchestration.totals.byRole.map((group) => group.role).sort(), context).toEqual(
        [...roles].sort(),
      );
      expect(
        orchestration.totals.byRole.reduce((total, group) => total + group.runs, 0),
        context,
      ).toBe(expected.crew.length);

      const labels = [...roles].map((role) => agentRoleLabel(role)).sort();
      if (!answersOnly) {
        const [audited] = audit.orchestrations ?? [];
        expect(audited?.totals.totalTokens, context).toBe(orchestration.totals.tokens);
        expect(audited?.byRole.map((group) => group.role).sort(), context).toEqual(labels);
        const rootRole = expected.crew[0] === SCOUT ? 'Reader' : 'Orchestration';
        expect(audit.runs.find((run) => run.runId === runId)?.role, context).toBe(rootRole);
      } else {
        expect(
          audit.runs.map((run) => run.role),
          context,
        ).toEqual(labels);
      }

      const critic = orchestration.crew.find((member) => member.role === 'critic');
      if (critic) {
        expect(critic, context).toMatchObject({ provider: 'codex', verdict: 'looks_good' });
        const task = await getTaskDetail(t.db, orchestration.taskId!);
        expect(
          task?.items.some((item) => item.label.startsWith('Hawk · Critic')),
          context,
        ).toBe(true);
      }
    }
  }, 180_000);
});

describe('rule routing on Auto', () => {
  it('routes a trivial fix to the middle tier and maps Jev’s small-tier pick there', async () => {
    const { orchestration } = await runLevel(TRIVIAL, 'hands-off');
    expect(orchestration.depth).toBe('execute');
    expect(orchestration.crew).toEqual([
      expect.objectContaining({
        role: 'builder',
        model: 'sonnet',
        effort: 'medium',
        routedBy: 'rules',
        autoWouldUse: expect.objectContaining({ model: 'sonnet' }),
      }),
    ]);
    expect(orchestration.crew[0]?.routeNote).toBeUndefined();
    const route = orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.summary).toContain('trivial → middle tier');
    expect(route?.answer).toMatchObject({ rule: 'trivial → middle tier', jevTier: 'small' });
  }, 60_000);

  it("answers on the provider's default model in an Auto chat, whatever model the chat had", async () => {
    const { orchestration } = await runLevel(QUESTION, 'hands-off', 'auto', 'haiku');
    expect(orchestration.crew).toEqual([
      expect.objectContaining({ role: 'scout', model: 'opus[1m]' }),
    ]);
    const route = orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.summary).toContain("the chat's own model, kept for the whole chat");
  }, 60_000);

  it('answers on Haiku when the user picked it, with a retiring note', async () => {
    const { orchestration } = await runLevel(QUESTION, 'hands-off', 'pinned', 'haiku');
    const note = 'Haiku 4.5 retiring on 2026-10-15';
    expect(orchestration.crew).toEqual([
      expect.objectContaining({ role: 'scout', model: 'haiku', routeNote: note }),
    ]);
    const route = orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.answer).toMatchObject({ routedBy: 'pinned', note });
  }, 60_000);

  it('runs destructive work on the top tier with a cross-provider Critic', async () => {
    const { orchestration } = await runLevel(RISKY, 'full-auto');
    expect(orchestration.risk).toBe('destructive');
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['scout', 'opus[1m]'],
      ['builder', 'opus[1m]'],
      ['critic', 'gpt-6-sol'],
    ]);
  }, 60_000);
});
