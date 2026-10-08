import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { getSetupState, sparkPreferences, updateProfile } from '../src/persistence/setup.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { prepareNativeSession } from '../src/terminal/native-prepare.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
beforeEach(async () => {
  t = await createTestDb();
  root = await mkdtemp(join(tmpdir(), 'spark-instructions-db-'));
});
afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

it('persists text and file path, reads fresh contents, and can clear both', async () => {
  const file = join(root, 'instructions.md');
  await writeFile(file, 'Use tests.');
  await updateProfile(t.db, t.workspaceId, {
    agentInstructions: 'Be concise.',
    agentInstructionsFile: file,
  });
  expect((await getSetupState(t.db, t.workspaceId)).profile).toMatchObject({
    agentInstructions: 'Be concise.',
    agentInstructionsFile: file,
  });
  expect((await sparkPreferences(t.db, t.workspaceId)).agentInstructions).toBe(
    'Be concise.\n\nUse tests.',
  );
  await writeFile(file, 'Check keyboard focus.');
  expect((await sparkPreferences(t.db, t.workspaceId)).agentInstructions).toContain(
    'Check keyboard focus.',
  );
  await updateProfile(t.db, t.workspaceId, { agentInstructions: '', agentInstructionsFile: '' });
  expect((await sparkPreferences(t.db, t.workspaceId)).agentInstructions).toBe('');
});

it('keeps the previous setting if a replacement file cannot be read', async () => {
  await updateProfile(t.db, t.workspaceId, { agentInstructions: 'Keep this.' });
  await expect(
    updateProfile(t.db, t.workspaceId, {
      agentInstructions: 'Replace',
      agentInstructionsFile: join(root, 'missing.md'),
    }),
  ).rejects.toThrow('could not be read');
  expect((await getSetupState(t.db, t.workspaceId)).profile.agentInstructions).toBe('Keep this.');
});

it('keeps terminal tracking and custom instructions when Spark workflow is off, including resume', async () => {
  await updateProfile(t.db, t.workspaceId, {
    sparkEnabled: false,
    agentInstructions: 'My own workflow.',
  });
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId, {
    sessionType: 'terminal',
    terminalProvider: 'claude',
  });
  const deps = {
    db: t.db,
    workspaceId: t.workspaceId,
    dataDir: root,
    channel: 'test',
    place: async (_deps: unknown, input: RunInput) => ({ input, repoRoot: null, note: null }),
  };
  const first = await prepareNativeSession(
    deps,
    conversationId,
    'claude',
    { prompt: 'Inspect the project.', resume: false },
    null,
  );
  expect(first.workflowEnabled).toBe(false);
  expect(first.instructions).toBe('My own workflow.');
  expect(first.prompt).toBe('Inspect the project.');
  expect(first.runId).toBeTruthy();
  await t.db.query("UPDATE runs SET status = 'succeeded' WHERE id = $1", [first.runId]);
  await updateProfile(t.db, t.workspaceId, { agentInstructions: 'New instructions.' });
  const resumed = await prepareNativeSession(
    deps,
    conversationId,
    'claude',
    { resume: true },
    null,
  );
  expect(resumed.prompt).toBe('');
  expect(resumed.instructions).toBe('New instructions.');
  expect(resumed.workflowEnabled).toBe(false);
});
