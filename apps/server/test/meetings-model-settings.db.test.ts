import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  meetingModelView,
  meetingRunsOn,
  saveMeetingModel,
} from '../src/meetings/model-settings.ts';
import { childRunNotesModel } from '../src/meetings/notes-model.ts';
import { createMeeting } from '../src/meetings/store.ts';
import { saveCapabilities } from '../src/persistence/chat-settings.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Ada', 'claude', now())`,
    [t.workspaceId],
  );
});

afterEach(async () => {
  await t.cleanup();
});

async function connect(provider: 'claude' | 'codex') {
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, $2, 'cli', 'test', '[]', NULL, 'ask', 'high', now())`,
    [t.workspaceId, provider],
  );
}

async function offer(provider: 'claude' | 'codex', models: string[]) {
  await saveCapabilities(t.db, t.workspaceId, {
    provider,
    models: models.map((id) => ({ id, label: id.toUpperCase(), description: null })),
    efforts: [
      { id: 'low', label: 'Low', description: null },
      { id: 'high', label: 'High', description: null },
    ],
    defaultModel: models[0] ?? null,
  });
}

describe('the meeting model setting', () => {
  it('starts on the default provider with no pick, and runs nowhere without a provider', async () => {
    expect(await meetingModelView(t.db, t.workspaceId)).toEqual({
      settings: { provider: null, model: null, effort: null },
      runsOn: null,
    });
    await connect('claude');
    const view = await meetingModelView(t.db, t.workspaceId);
    expect(view.runsOn?.provider).toBe('claude');
  });

  it('refuses a provider that is not connected', async () => {
    await connect('claude');
    await expect(
      saveMeetingModel(t.db, t.workspaceId, { provider: 'codex', model: null, effort: null }),
    ).rejects.toThrow('Connect this provider before meetings use it.');
  });

  it('uses the picked provider, model and effort', async () => {
    await connect('claude');
    await connect('codex');
    await offer('codex', ['alpha', 'beta']);
    const view = await saveMeetingModel(t.db, t.workspaceId, {
      provider: 'codex',
      model: 'beta',
      effort: 'high',
    });
    expect(view.runsOn).toEqual({
      provider: 'codex',
      model: 'beta',
      modelLabel: 'BETA',
      effort: 'high',
    });
  });

  it('falls back to the fast choice when the pick is no longer offered', async () => {
    await connect('claude');
    await offer('claude', ['alpha']);
    await saveMeetingModel(t.db, t.workspaceId, { provider: null, model: 'gone', effort: 'max' });
    const fast = await meetingRunsOn(t.db, t.workspaceId);
    await saveMeetingModel(t.db, t.workspaceId, { provider: null, model: null, effort: null });
    expect(fast).toEqual(await meetingRunsOn(t.db, t.workspaceId));
    expect(fast?.model).not.toBe('gone');
  });

  it('falls back to the default provider when the picked one is disconnected', async () => {
    await connect('claude');
    await connect('codex');
    await offer('codex', ['beta']);
    await saveMeetingModel(t.db, t.workspaceId, { provider: 'codex', model: 'beta', effort: null });
    await t.db.query(
      `UPDATE provider_connections SET disconnected_at = now()
       WHERE workspace_id = $1 AND provider = 'codex'`,
      [t.workspaceId],
    );
    const runsOn = await meetingRunsOn(t.db, t.workspaceId);
    expect(runsOn?.provider).toBe('claude');
    expect(runsOn?.model).not.toBe('beta');
  });

  it('starts the notes run on the picked model', async () => {
    await connect('claude');
    await offer('claude', ['alpha', 'beta']);
    await saveMeetingModel(t.db, t.workspaceId, { provider: null, model: 'beta', effort: 'high' });
    const meeting = await createMeeting(t.db, t.workspaceId, { title: 'Planning' });
    const written = childRunNotesModel(t.db, t.workspaceId, 20)
      .complete('hello', meeting.id)
      .catch(() => undefined);
    const rows = await eventually(async () => {
      const found = await t.db.query(
        `SELECT r.provider, r.model, r.effort FROM runs r
         JOIN meeting_note_runs n ON n.run_id = r.id`,
      );
      return found.rows.length > 0 && found.rows;
    });
    expect(rows).toEqual([{ provider: 'claude', model: 'beta', effort: 'high' }]);
    await t.db.query(`UPDATE runs SET status = 'failed'`);
    await written;
  });
});
