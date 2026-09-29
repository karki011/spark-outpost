import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildStyle, ReviewBody, ShortcutsBody } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { createProject } from '../src/projects/projects.ts';
import {
  COMPLEX,
  TRIVIAL,
  artifactBodies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

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

function start(scenario: Scenario) {
  const script: JevScript = { calls: [], scenario };
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

async function builderPrompt(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ prompt: string }>(
    `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
    [runId],
  );
  return rows[0]?.prompt ?? '';
}

describe('the lean build style', { timeout: 60_000 }, () => {
  it('leaves an off project without the ladder and without markers', async () => {
    await configure('off');
    const script = start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(script.calls.some((call) => call.questions.includes('build_style'))).toBe(false);
    expect(await builderPrompt(runId)).not.toContain('## Build style');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\nstep 1\n');
  });

  it('builds lean by default when the project never chose a style', async () => {
    start(TRIVIAL);
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await builderPrompt(runId)).toContain('## Build style: lean');
  });

  it('tells the task Builder the ladder and harvests its lean: markers', async () => {
    await configure('lean');
    const marked = withTag(TRIVIAL, '#leanmark');
    start(marked);
    const { conversationId, runId } = await startScenario(t, root, marked, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    expect(await builderPrompt(runId)).toContain('7. Only then write the minimum code that works.');
    expect(await artifactBodies<ShortcutsBody>(t, 'shortcuts')).toEqual([
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

  it('eases to lite when the request asks for a complete version', async () => {
    await configure('lean');
    const full = withTag(TRIVIAL, 'Build the complete version.');
    start(full);
    const { conversationId, runId } = await startScenario(t, root, full, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    expect(await builderPrompt(runId)).toContain('## Build style: lite');
  });

  it('adds the complexity lens to the single Critic pass and keeps its net line', async () => {
    await configure('lean');
    const reviewed = { ...COMPLEX, review: 0.95 };
    start(reviewed);
    const { conversationId, runId } = await startScenario(t, root, reviewed, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.crew.filter((member) => member.role === 'critic')).toHaveLength(1);
    const { rows } = await t.db.query<{ role: string; prompt: string }>(
      `SELECT role, prompt FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
      [runId],
    );
    const prompt = (role: string) => rows.find((row) => row.role === role)?.prompt ?? '';
    expect(prompt('builder')).toContain('7. Only then write the minimum code that works.');
    expect(prompt('critic')).toContain('## Complexity (same review)');
    const [review] = await artifactBodies<ReviewBody>(t, 'review');
    expect(review).toMatchObject({ verdict: 'looks_good', net: -2 });
    expect(review!.findings).toContain('notes.txt:L2: shrink: two lines say the same');
  });
});
