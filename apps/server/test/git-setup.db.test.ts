import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunCommand } from '../src/setup/command.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

function appWith(runCommand: RunCommand) {
  return localClient(createTestApp(t, { runCommand }));
}

describe('git setup check', () => {
  it('reports the installed git version', async () => {
    const commands: string[] = [];
    const app = appWith(async (file, args) => {
      commands.push([file, ...args].join(' '));
      return { code: 0, stdout: 'git version 2.47.1\n', stderr: '' };
    });
    const { body } = await app.get('/api/setup/git').expect(200);
    expect(body).toMatchObject({ installed: true, version: '2.47.1' });
    await app.send('post', '/api/setup/git/install', {}).expect(200);
    expect(commands).toEqual(['git --version', 'git --version']);
  });

  it('reports a missing git and explains a failed installer', async () => {
    const app = appWith(async () => ({ code: 1, stdout: '', stderr: 'not found' }));
    const { body } = await app.get('/api/setup/git').expect(200);
    expect(body).toMatchObject({ installed: false, version: null });
    const failed = await app.send('post', '/api/setup/git/install', {}).expect(400);
    expect(failed.body.error).toMatch(/xcode-select --install/);
  });
});
