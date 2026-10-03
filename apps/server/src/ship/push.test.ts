import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRemoteHeads } from './git.ts';
import { pushCommand, TOKEN_ENV, withTokenAccess } from './push.ts';

const TOKEN = 'github_pat_11SECRETSECRET_0123456789abcdef';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'spark-push-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://127.0.0.1:9/acme/x.git']);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pushing with the GitHub connection', () => {
  it('hands git the token only through the one-shot askpass environment', async () => {
    let script = '';
    await withTokenAccess(TOKEN, async (access) => {
      expect(access.config).toEqual(['-c', 'credential.helper=']);
      expect(access.env[TOKEN_ENV]).toBe(TOKEN);
      script = access.env.GIT_ASKPASS!;
      const text = await readFile(script, 'utf8');
      expect(text).not.toContain(TOKEN);
      const answer = execFileSync(script, ['Password for https://github.com:'], {
        env: { ...process.env, ...access.env },
        encoding: 'utf8',
      });
      expect(answer.trim()).toBe(TOKEN);
    });
    await expect(readdir(path.dirname(script))).rejects.toThrow();
  });

  it('never shows the token in a failed git error or in config', async () => {
    const failure = await withTokenAccess(TOKEN, (access) =>
      listRemoteHeads(root, 'origin', access).then(
        () => null,
        (error: Error) => error,
      ),
    );
    expect(failure?.message).toMatch(/Reaching origin failed/);
    expect(failure?.message).not.toContain(TOKEN);
    expect(await readFile(path.join(root, '.git', 'config'), 'utf8')).not.toContain(TOKEN);
  });

  it('gives the exact push command to try in a terminal', () => {
    expect(pushCommand('/work/my app', 'origin', 'spark/fix')).toBe(
      "git -C '/work/my app' push --set-upstream origin spark/fix",
    );
  });
});
