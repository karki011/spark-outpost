import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildStyle, CheckBody, ReviewBody, ShortcutsBody } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { taskChanges } from '../src/projects/task-changes.ts';
import { createProject } from '../src/projects/projects.ts';
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

const TRIVIAL = SCENARIOS[1] as Scenario;
const COMPLEX = SCENARIOS[3] as Scenario;

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

function start(
  scenario: Scenario,
  buildStyle?: JevScript['buildStyle'],
  parallel?: JevScript['parallel'],
) {
  const script: JevScript = {
    calls: [],
    scenario,
    ...(buildStyle ? { buildStyle } : {}),
    ...(parallel ? { parallel } : {}),
  };
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
  return script;
}

async function configure(style: BuildStyle, checks: string[] | null = []): Promise<void> {
  const { project } = await createProject(t.db, t.workspaceId, root);
  await t.db.query('UPDATE projects SET build_style = $2, check_commands = $3 WHERE id = $1', [
    project.id,
    style,
    checks,
  ]);
}

async function artifacts<T>(kind: string): Promise<T[]> {
  const { rows } = await t.db.query<{ body: T }>(
    'SELECT body FROM run_artifacts WHERE kind = $1 ORDER BY version',
    [kind],
  );
  return rows.map((row) => row.body);
}

async function decision(runId: string) {
  const { rows } = await t.db.query<{ applied: string; summary: string; chosen: string }>(
    `SELECT body->>'applied' AS applied, body->>'summary' AS summary,
       body->'answer'->>'chosen' AS chosen
     FROM run_advice WHERE run_id = $1 AND purpose = 'build_style'`,
    [runId],
  );
  return rows;
}

describe('the lean build style', () => {
  it('leaves an off project exactly as before: no Jev question, no decision, no markers', async () => {
    await configure('off');
    const script = start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(script.calls.some((call) => call.questions.includes('build_style'))).toBe(false);
    expect(await decision(runId)).toEqual([]);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\n');
  });

  it('tells the in-place Builder the ladder and harvests its lean: markers', async () => {
    await configure('lean');
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await decision(runId)).toEqual([
      {
        applied: 'rules',
        chosen: 'lean',
        summary:
          'Build style lean · rule would have used lean (project setting) · Jev said lean at 0.50',
      },
    ]);
    expect(await artifacts<ShortcutsBody>('shortcuts')).toEqual([
      {
        runId,
        style: 'lean',
        entries: [
          {
            path: 'notes.txt',
            line: 3,
            ceiling: 'fixed list',
            upgrade: 'load from config when asked',
          },
        ],
      },
    ]);
    const detail = await getConversationDetail(t.db, conversationId);
    const item = detail?.tasks[0]?.items.find((entry) => entry.id.startsWith('shortcut:'));
    expect(item).toMatchObject({
      label: 'Deferred shortcut: 1 marked lean:',
      output: 'notes.txt:3, fixed list. upgrade: load from config when asked.',
    });
  });

  it('lets a sure Jev ease the style within the project setting and records the rule', async () => {
    await configure('lean');
    start(TRIVIAL, { choice: 'lite', confidence: 0.91 });
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(await decision(runId)).toEqual([
      {
        applied: 'jev',
        chosen: 'lite',
        summary:
          'Build style lite · rule would have used lean (project setting) · Jev said lite at 0.91',
      },
    ]);
    expect(await artifacts('shortcuts')).toEqual([]);
  });

  it('adds the complexity lens to the single Critic pass and keeps its net line', async () => {
    await configure('lean');
    start(COMPLEX);
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.crew.filter((member) => member.role === 'critic')).toHaveLength(1);
    const { rows } = await t.db.query<{ role: string; prompt: string }>(
      `SELECT role, prompt FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
      [runId],
    );
    const prompt = (role: string) => rows.find((row) => row.role === role)?.prompt ?? '';
    expect(prompt('architect')).toContain('"Reuse: <file or function>"');
    expect(prompt('builder')).toContain('7. Only then write the minimum code that works.');
    expect(prompt('critic')).toContain('## Complexity (same review)');
    const [review] = await artifacts<ReviewBody>('review');
    expect(review).toMatchObject({ verdict: 'looks_good', net: -2 });
    expect(review!.findings).toContain('notes.txt:L2: shrink: two lines say the same');
  });
});

describe('parallel lanes in the shared working tree', () => {
  it('runs disjoint lanes side by side, attributes each diff, checks and reviews the merge once', async () => {
    await writeFile(join(root, 'check.mjs'), "console.log('ok');\n");
    await configure('off', ['node check.mjs']);
    start(COMPLEX, undefined, { same_folder: 0.95 });
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #parallel #chains #sleepstep 3` };
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');

    const builders = orchestration.crew.filter((member) => member.role === 'builder');
    expect(
      builders.map((member) => [member.name, member.parallelGroup, member.copy ?? null]),
    ).toEqual([
      ['Bolt', 'g1', null],
      ['Rivet', 'g1', null],
    ]);
    const { rows: copies } = await t.db.query('SELECT 1 FROM run_worktrees');
    expect(copies).toEqual([]);
    expect(await readFile(join(root, 'src/dates.ts'), 'utf8')).toBe('step 1\n');
    expect(await readFile(join(root, 'src/turns.ts'), 'utf8')).toBe('step 3\n');

    const checks = await artifacts<CheckBody>('check');
    expect(checks.map((body) => [body.name, body.status])).toEqual([['Bolt and Rivet', 'passed']]);
    expect(orchestration.crew.filter((member) => member.role === 'critic')).toHaveLength(1);

    const changes = await taskChanges(t.db, t.workspaceId, orchestration.taskId!);
    const byRun = new Map(
      changes.runs.map((run) => [run.runId, run.files.map((file) => file.path).sort()]),
    );
    expect(byRun.get(builders[0]!.runId)).toEqual(['src/dates.ts', 'src/divider.tsx']);
    expect(byRun.get(builders[1]!.runId)).toEqual(['src/turns.ts']);

    const { rows } = await t.db.query<{ summary: string }>(
      `SELECT body->>'summary' AS summary FROM run_advice WHERE run_id = $1 AND purpose = 'parallel'`,
      [runId],
    );
    expect(rows[0]?.summary).toContain(
      'shared tree (Jev is sure the Builders can share the folder; Jev 0.95 on sharing; rule: shared tree)',
    );
  });

  it('keeps worktrees when Jev is unsure the Builders can share the folder', async () => {
    start(COMPLEX, undefined, { same_folder: 0.6 });
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #parallel #chains` };
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    const builders = orchestration.crew.filter((member) => member.role === 'builder');
    expect(builders.every((member) => member.copy?.startsWith('spark/'))).toBe(true);
    const summary = await parallelSummary(runId);
    expect(summary).toContain('worktrees (Jev is unsure; Jev 0.60 on sharing; rule: shared tree)');
  });

  it('lets one Builder carry the chains when Jev is sure that is as good', async () => {
    start(COMPLEX, undefined, { one_builder: 0.9 });
    const scenario = { ...COMPLEX, text: `${COMPLEX.text} #parallel #chains` };
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    const builders = orchestration.crew.filter((member) => member.role === 'builder');
    expect(builders.map((member) => member.parallelGroup ?? null)).toEqual([null]);
    expect(await parallelSummary(runId)).toContain(
      'Chains: one Builder (jev; Jev 0.90 on one Builder; rule: split)',
    );
  });
});

async function parallelSummary(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ summary: string }>(
    `SELECT body->>'summary' AS summary FROM run_advice WHERE run_id = $1 AND purpose = 'parallel'`,
    [runId],
  );
  return rows[0]?.summary ?? '';
}
