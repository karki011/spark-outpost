import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codeModeEnabled } from '../src/persistence/code-mode-settings.ts';
import { sparkPreferences } from '../src/persistence/setup.ts';
import { sparkGrantKey, startSparkMcpHost } from '../src/spark-mcp/host.ts';
import { recordedHooks, toolDeps } from './spark-mcp-support.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.cleanup();
});
const appWith = () => localClient(createTestApp(t));

describe('Code Mode preference', () => {
  it('defaults on, persists off across clients and supports turning back on', async () => {
    vi.stubEnv('SPARK_CODE_MODE', undefined);
    expect((await appWith().get('/api/setup').expect(200)).body.profile.codeMode).toBe(true);
    expect((await sparkPreferences(t.db, t.workspaceId)).codeMode).toBe(true);
    await appWith().send('patch', '/api/profile', { codeMode: false }).expect(200);
    expect((await appWith().get('/api/setup').expect(200)).body.profile.codeMode).toBe(false);
    expect((await sparkPreferences(t.db, t.workspaceId)).codeMode).toBe(false);
    expect(await codeModeEnabled(t.db, t.workspaceId)).toBe(false);
    await appWith().send('patch', '/api/profile', { displayName: 'Saved choice' }).expect(200);
    expect(await codeModeEnabled(t.db, t.workspaceId)).toBe(false);
    await appWith().send('patch', '/api/profile', { codeMode: true }).expect(200);
    expect((await sparkPreferences(t.db, t.workspaceId)).codeMode).toBe(true);
    expect(await codeModeEnabled(t.db, t.workspaceId)).toBe(true);
    await appWith().send('patch', '/api/profile', { codeMode: 'false' }).expect(400);
  });

  it('changes the live tool signature after a saved preference change', async () => {
    vi.stubEnv('SPARK_CODE_MODE', undefined);
    const chat = await startChat(t, 'Check Code Mode settings');
    const recorded = recordedHooks();
    const host = await startSparkMcpHost(toolDeps(t));
    const scope = async () => ({
      workspaceId: t.workspaceId,
      ...chat,
      actions: recorded.hooks,
      codeMode: (await sparkPreferences(t.db, t.workspaceId)).codeMode,
    });
    try {
      const first = await host.grant(await scope());
      expect(first.offered).toContain('spark_execute');
      await appWith().send('patch', '/api/profile', { codeMode: false }).expect(200);
      const off = await host.rebind(await scope(), sparkGrantKey(first.token));
      expect(off.offered).not.toContain('spark_execute');
      expect(off.offered).not.toBe(first.offered);
      await appWith().send('patch', '/api/profile', { codeMode: true }).expect(200);
      const on = await host.rebind(await scope(), sparkGrantKey(first.token));
      expect(on.offered).toBe(first.offered);
    } finally {
      recorded.stop();
      await host.close();
    }
  });

  it('reports the installation override without changing the saved preference', async () => {
    vi.stubEnv('SPARK_CODE_MODE', '0');
    const { body } = await appWith().get('/api/setup').expect(200);
    expect(body.profile).toMatchObject({ codeMode: false, codeModeUnavailable: true });
    expect((await sparkPreferences(t.db, t.workspaceId)).codeMode).toBe(false);
    expect(await codeModeEnabled(t.db, t.workspaceId)).toBe(false);
    vi.stubEnv('SPARK_CODE_MODE', undefined);
    expect((await appWith().get('/api/setup').expect(200)).body.profile.codeMode).toBe(true);
    expect(await codeModeEnabled(t.db, t.workspaceId)).toBe(true);
    await appWith().send('patch', '/api/profile', { codeMode: false }).expect(200);
    vi.stubEnv('SPARK_CODE_MODE', '1');
    expect(await codeModeEnabled(t.db, t.workspaceId)).toBe(false);
  });
});
