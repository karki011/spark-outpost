import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stepSparks } from '../src/crew-flows/step-sparks.ts';
import { createTeammate, getTeammate, updateTeammate } from '../src/persistence/teammates.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let sparks: string;

beforeEach(async () => {
  t = await createTestDb();
  sparks = await mkdtemp(join(tmpdir(), 'spark-effort-'));
});

afterEach(async () => {
  await t.cleanup();
  await rm(sparks, { recursive: true, force: true });
});

describe('a Spark’s effort', () => {
  it('is kept, changed and cleared, and reaches its workflow steps', async () => {
    const created = await createTeammate(
      t.db,
      t.workspaceId,
      {
        name: 'Scribe',
        role: 'Release notes writer',
        provider: 'claude',
        model: 'claude-haiku-5-5',
        effort: 'high',
        agentMode: null,
        level: null,
        instructions: '',
        projectIds: [],
      },
      sparks,
    );
    expect(created.effort).toBe('high');
    const steps = await stepSparks(t.db, t.workspaceId, [created.id]);
    expect(steps.get(created.id)).toMatchObject({ model: 'claude-haiku-5-5', effort: 'high' });

    await updateTeammate(t.db, t.workspaceId, created.id, { effort: 'low' }, sparks);
    expect((await getTeammate(t.db, t.workspaceId, created.id, sparks)).effort).toBe('low');
    await updateTeammate(t.db, t.workspaceId, created.id, { effort: null }, sparks);
    expect((await getTeammate(t.db, t.workspaceId, created.id, sparks)).effort).toBeNull();
  });
});
