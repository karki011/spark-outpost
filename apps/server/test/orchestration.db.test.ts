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
import { createTestDb, type TestDb } from './support.ts';

const B: AgentRole = 'builder';
const C: AgentRole = 'critic';

interface Expectation {
  crew: AgentRole[];
  asked: string[];
}

const asksEdits = (crew: AgentRole[]): Record<InvolvementLevel, Expectation> => ({
  balanced: { crew, asked: ['edit', 'accept'] },
  'hands-off': { crew, asked: [] },
  'full-auto': { crew, asked: [] },
});

const EXPECTED: Record<string, Record<InvolvementLevel, Expectation>> = {
  question: {
    balanced: { crew: ['scout'], asked: [] },
    'hands-off': { crew: ['scout'], asked: [] },
    'full-auto': { crew: ['scout'], asked: [] },
  },
  trivial: asksEdits([B]),
  normal: asksEdits([B]),
  complex: asksEdits([B]),
  risky: {
    balanced: { crew: [B, C], asked: ['plan', 'edit', 'accept'] },
    'hands-off': { crew: [B, C], asked: ['plan'] },
    'full-auto': { crew: [B, C], asked: [] },
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

      const kept = orchestration.checkpoints.filter(
        (approval) => approval.kind === 'accept' && approval.decidedBy === 'level',
      );
      const keptBy = level === 'balanced' || expected.crew[0] === 'scout' ? [] : [level];
      expect(
        kept.map((approval) => approval.payload.checkpoint?.keptBy),
        context,
      ).toEqual(keptBy);
      if (level === 'hands-off' && keptBy.length > 0) {
        expect(kept[0]!.reason, context).toContain('Auto-edit kept the changes');
      }

      const builders = expected.crew.filter((role) => role === B).length;
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

      const labels = [...roles].map((role) => role.charAt(0).toUpperCase() + role.slice(1)).sort();
      if (expected.crew[0] !== 'scout') {
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
    }
  }, 180_000);
});

describe('rule routing on Auto', () => {
  it('raises a trivial fix off the small tier, since Builders never run there', async () => {
    const { orchestration } = await runLevel(SCENARIOS[1]!, 'hands-off');
    expect(orchestration.depth).toBe('execute');
    const note = "raised to Sonnet 5: Builders don't run on the fast tier";
    expect(orchestration.crew).toEqual([
      expect.objectContaining({
        role: 'builder',
        model: 'sonnet',
        effort: 'medium',
        routedBy: 'rules',
        autoWouldUse: expect.objectContaining({ model: 'sonnet' }),
        routeNote: note,
      }),
    ]);
    const route = orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.summary).toContain(`trivial → small tier · ${note}`);
    expect(route?.answer).toMatchObject({ note, jevTier: 'small' });
  }, 60_000);

  it('runs destructive work on the top tier with a cross-provider Critic', async () => {
    const { orchestration } = await runLevel(SCENARIOS[4]!, 'full-auto');
    expect(orchestration.risk).toBe('destructive');
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'opus[1m]'],
      ['critic', 'gpt-6-sol'],
    ]);
  }, 60_000);
});
