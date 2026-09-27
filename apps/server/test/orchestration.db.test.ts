import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRole, InvolvementLevel } from '@spark-outpost/contracts';
import { conversationAuditRuns, summarizeAudit } from '../src/persistence/audit-summary.ts';
import { getTaskDetail } from '../src/persistence/task-views.ts';
import {
  LEVELS,
  SCENARIOS,
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
import { FAKE_PLAN_FILES } from './fake-acp-roles.ts';
import { createTestDb, type TestDb } from './support.ts';

const A: AgentRole = 'architect';
const B: AgentRole = 'builder';
const C: AgentRole = 'critic';
const PLANNED_BUILD = [A, B];

interface Expectation {
  crew: AgentRole[];
  asked: string[];
}

const EXPECTED: Record<string, Record<InvolvementLevel, Expectation>> = {
  question: {
    'hands-on': { crew: ['scout'], asked: [] },
    balanced: { crew: ['scout'], asked: [] },
    'hands-off': { crew: ['scout'], asked: [] },
    'full-auto': { crew: ['scout'], asked: [] },
  },
  trivial: {
    'hands-on': { crew: [B], asked: ['edit', 'accept'] },
    balanced: { crew: [B], asked: ['edit', 'accept'] },
    'hands-off': { crew: [B], asked: [] },
    'full-auto': { crew: [B], asked: [] },
  },
  normal: {
    'hands-on': { crew: [B], asked: ['edit', 'accept'] },
    balanced: { crew: [B], asked: ['edit', 'accept'] },
    'hands-off': { crew: [B], asked: [] },
    'full-auto': { crew: [B], asked: [] },
  },
  complex: {
    'hands-on': { crew: [...PLANNED_BUILD, C], asked: ['plan', 'edit', 'accept'] },
    balanced: { crew: [...PLANNED_BUILD, C], asked: ['plan', 'edit', 'accept'] },
    'hands-off': { crew: [...PLANNED_BUILD, C], asked: [] },
    'full-auto': { crew: [...PLANNED_BUILD, C], asked: [] },
  },
  risky: {
    'hands-on': {
      crew: [...PLANNED_BUILD, C],
      asked: ['clarify', 'plan', 'edit', 'accept'],
    },
    balanced: { crew: [...PLANNED_BUILD, C], asked: ['plan', 'edit', 'accept'] },
    'hands-off': { crew: [...PLANNED_BUILD, C], asked: ['plan'] },
    'full-auto': { crew: [...PLANNED_BUILD, C], asked: [] },
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

async function runLevel(scenario: Scenario, level: InvolvementLevel) {
  const root = await gitRepo();
  try {
    const { conversationId, runId } = await startScenario(t, root, scenario, level);
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

      const planned = expected.crew.includes(A);
      expect(notes.split('\n').filter((line) => line.startsWith('step')).length, context).toBe(
        planned ? FAKE_PLAN_FILES.length : expected.crew.filter((role) => role === B).length,
      );
      if (expected.crew.length === 1) expect(orchestration.crew[0]!.runId, context).toBe(runId);

      const kinds = orchestration.decisions.map((decision) => decision.kind);
      expect(
        kinds.filter((kind) => kind === 'intake'),
        context,
      ).toHaveLength(1);
      expect(
        kinds.filter((kind) => kind === 'route'),
        context,
      ).toHaveLength(expected.crew.length);
      const judged = expected.crew.filter((role) => role === 'builder' || role === 'critic');
      expect(
        kinds.filter((kind) => kind === 'transition'),
        context,
      ).toHaveLength(judged.length);

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

      const labels = [...roles].map((role) => role.charAt(0).toUpperCase() + role.slice(1)).sort();
      if (expected.crew.length > 1) {
        const [audited] = audit.orchestrations ?? [];
        expect(audited?.totals.totalTokens, context).toBe(orchestration.totals.tokens);
        expect(audited?.byRole.map((group) => group.role).sort(), context).toEqual(labels);
        expect(audit.runs.find((run) => run.runId === runId)?.role, context).toBe('Orchestration');
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
      const architect = orchestration.crew.find((member) => member.role === 'architect');
      if (architect) {
        expect(architect, context).toMatchObject({
          model: 'opus[1m]',
          effort: 'high',
          routedBy: 'rules',
        });
        expect(orchestration.planVersion, context).toBe(1);
      }
    }
  }, 180_000);
});

describe('trivial fix on Auto', () => {
  it('runs a single Haiku builder at low effort without a planner', async () => {
    const { orchestration } = await runLevel(SCENARIOS[1]!, 'hands-off');
    expect(orchestration.depth).toBe('execute');
    expect(orchestration.crew).toEqual([
      expect.objectContaining({ role: 'builder', model: 'haiku', effort: 'low', routedBy: 'jev' }),
    ]);
  }, 60_000);
});
