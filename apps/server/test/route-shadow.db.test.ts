import { POLICY_VERSION } from '../src/advisor/policy.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner } from '../src/codescan/scanner.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { routingLabels } from '../src/persistence/routing-labels.ts';
import { toLabel } from '../src/routing/labels.ts';
import {
  SCENARIOS,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const NORMAL = SCENARIOS[2] as Scenario;
const RISKY = SCENARIOS[4] as Scenario;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(
    join(root, 'divider.ts'),
    'export function dayDivider(at: number) { return at; }\n',
  );
  await writeFile(
    join(root, 'divider-view.ts'),
    "import { dayDivider } from './divider';\nexport const view = (at: number) => dayDivider(at);\n",
  );
  await writeFile(
    join(root, 'midnight.ts'),
    "import { dayDivider } from './divider';\nexport const midnight = dayDivider(0);\n",
  );
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

afterAll(async () => {
  await stopParseWorker();
});

interface AdviceRow {
  purpose: string;
  jev_status: string;
  policy_version: string | null;
  body: { summary: string; answer: Record<string, unknown>; state: Record<string, unknown> };
}

async function rows(runId: string, purpose: string): Promise<AdviceRow[]> {
  const { rows: found } = await t.db.query<AdviceRow>(
    `SELECT purpose, jev_status, policy_version, body FROM run_advice
     WHERE run_id = $1 AND purpose = $2`,
    [runId, purpose],
  );
  return found;
}

async function run(scenario: Scenario, script: JevScript, routing: 'auto' | 'pinned' = 'auto') {
  const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
  harness = startOrchestrator(t, jevFetch(script), { codeScan: scanner });
  const { conversationId, runId } = await startScenario(t, root, scenario, 'full-auto', routing);
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  await scanner.idle();
  return { orchestration, runId };
}

const asked = (script: JevScript, key: string) =>
  script.calls.filter((call) => call.questions.includes(key));

describe('Jev routing in shadow mode', () => {
  it('records scan, file ranking and both route variants without changing the Builder', async () => {
    const script: JevScript = {
      calls: [],
      scenario: NORMAL,
      choices: { route: 'claude/haiku', likely_file: 'divider.ts' },
    };
    const { orchestration, runId } = await run(NORMAL, script);
    expect(orchestration.status).toBe('succeeded');
    const builder = orchestration.crew.find((member) => member.role === 'builder');
    expect(builder?.model).toBe('sonnet');

    expect(await rows(runId, 'scan')).toHaveLength(1);
    const [rank] = await rows(runId, 'rank');
    expect(rank).toMatchObject({ jev_status: 'answered', policy_version: POLICY_VERSION });
    expect(rank?.body.answer).toMatchObject({ observation: true, skipped: null });
    expect((rank?.body.answer.predicted as string[])[0]).toBe('divider.ts');

    const [shadow] = await rows(runId, 'route_shadow');
    expect(shadow?.jev_status).toBe('answered');
    expect(shadow?.body.answer).toMatchObject({
      observation: true,
      policy: 'ask',
      rule: { rule: 'chat model', pick: { model: 'sonnet' } },
      variants: {
        text: { status: 'answered', pick: { model: 'haiku' }, selection: { basis: 'choice' } },
        evidence: { status: 'answered', pick: { model: 'haiku' }, selection: { basis: 'choice' } },
      },
    });
    expect(shadow?.body.state.text).not.toHaveProperty('code_evidence');
    expect(
      String((shadow?.body.state.evidence as Record<string, unknown>).code_evidence),
    ).toContain('divider.ts');
    expect(shadow?.body.summary).toMatch(/^Shadow route: rules Sonnet 5 · Jev text-only Haiku 4.5/);
    expect(asked(script, 'route')).toHaveLength(2);
    expect(asked(script, 'likely_file')).toHaveLength(1);

    const view = await loadOrchestration(t.db, runId);
    const kinds = view?.decisions.map((decision) => decision.kind) ?? [];
    expect(kinds).not.toContain('rank');
    expect(kinds).not.toContain('route_shadow');

    const [label] = (await routingLabels(t.db)).map(toLabel);
    expect(label).toMatchObject({
      runId,
      policy: 'ask',
      rule: { pick: 'Sonnet 5', rule: 'chat model' },
      builder: 'Sonnet 5',
      jevText: { pick: 'Haiku 4.5', basis: 'choice' },
      jevEvidence: { pick: 'Haiku 4.5', basis: 'choice' },
      predictedFiles: expect.arrayContaining(['divider.ts']),
    });
    expect(label?.jevTokens).toBeGreaterThan(0);
  });

  it('does not ask the route question for a pinned model', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL };
    const { runId } = await run(NORMAL, script, 'pinned');
    const [shadow] = await rows(runId, 'route_shadow');
    expect(shadow).toMatchObject({ jev_status: 'not_asked' });
    expect(shadow?.body.answer).toMatchObject({
      policy: 'pinned',
      codePick: { model: 'sonnet' },
      variants: { text: null, evidence: null },
    });
    expect(asked(script, 'route')).toHaveLength(0);
    expect(await rows(runId, 'rank')).toHaveLength(1);
  });

  it('sends destructive work to the top tier by code, without a route call', async () => {
    const script: JevScript = { calls: [], scenario: RISKY };
    const { runId } = await run(RISKY, script);
    const [shadow] = await rows(runId, 'route_shadow');
    expect(shadow?.body.answer).toMatchObject({
      policy: 'destructive',
      codePick: { model: 'opus[1m]' },
      rule: { rule: 'destructive → top tier' },
    });
    expect(asked(script, 'route')).toHaveLength(0);
  });
});
