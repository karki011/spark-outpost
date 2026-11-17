import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { PermissionGate, ProviderOutput } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const CODEX_MODES = [
  'read-only',
  'ask-every-action',
  'workspace-write',
  'agent',
  'agent-full-access',
];

const codex = createAcpProvider({
  definition: agentDefinitions.codex,
  launch,
  env: {
    ...childEnvironment(process.env),
    FAKE_ACP_MODES: JSON.stringify(CODEX_MODES.map((mode) => [mode, mode, null, null])),
  },
  cancelGraceMs: 2_000,
});

const neverAsked: PermissionGate = {
  review: () => Promise.reject(new Error('no permission request expected')),
};

let main: string;
let worktree: string;
let git: string;

function run(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${String(result.stderr)}`);
}

beforeAll(async () => {
  main = await realpath(await mkdtemp(join(tmpdir(), 'spark-codex-worktree-')));
  git = join(main, '.git');
  worktree = join(main, '.spark', 'worktrees', 'w');
  run(main, 'init', '-q', '-b', 'main');
  await writeFile(join(main, 'a.txt'), 'a\n');
  run(main, 'add', '.');
  run(main, 'commit', '-qm', 'init');
  run(main, 'worktree', 'add', '-q', worktree, '-b', 'spark/w');
});

afterAll(async () => {
  await rm(main, { recursive: true, force: true });
});

async function sandboxed(mode: string, command: string): Promise<string> {
  const outputs: ProviderOutput[] = [];
  for await (const output of codex.run({
    prompt: `#sandboxed ${command}`,
    history: [],
    mode: 'do',
    settings: { method: 'cli', model: null, modelLabel: null, effort: null, mode },
    approvals: neverAsked,
    projectRoots: [worktree],
    signal: new AbortController().signal,
  })) {
    outputs.push(output);
  }
  return replyText(outputs);
}

describe.skipIf(process.platform !== 'darwin')(
  "Codex committing in a chat's worktree",
  { timeout: 30_000 },
  () => {
    it.each(['ask-every-action', 'workspace-write', 'agent'])(
      'commits in the %s mode and still cannot touch hooks, config or the main checkout',
      async (mode) => {
        await writeFile(join(worktree, 'a.txt'), `${mode}\n`);
        const text = await sandboxed(
          mode,
          [
            `git -c user.email=t@t -c user.name=t commit -qam ${mode} && echo COMMITTED`,
            `echo x > '${git}/hooks/pre-commit' && echo HOOK-WRITTEN`,
            `echo x >> '${git}/config' && echo CONFIG-WRITTEN`,
            `echo x >> '${git}/worktrees/w/config.worktree' && echo WORKTREE-CONFIG-WRITTEN`,
            `touch '${main}/outside' && echo MAIN-WRITTEN`,
            `git update-ref refs/heads/main HEAD && echo MAIN-REF-MOVED`,
            `git branch other && echo BRANCH-CREATED`,
            `git symbolic-ref HEAD refs/heads/main && echo HEAD-MOVED`,
            `echo x > '${git}/worktrees/w/commondir' && echo COMMONDIR-WRITTEN`,
          ].join('; '),
        );
        expect(text).toContain(`sandbox=${mode}`);
        expect(text).toContain('COMMITTED');
        expect(text).not.toContain('HOOK-WRITTEN');
        expect(text).not.toContain('CONFIG-WRITTEN');
        expect(text).not.toContain('MAIN-WRITTEN');
        expect(text).not.toContain('MAIN-REF-MOVED');
        expect(text).not.toContain('BRANCH-CREATED');
        expect(text).not.toContain('HEAD-MOVED');
        expect(text).not.toContain('COMMONDIR-WRITTEN');
      },
    );

    it('still cannot commit in a read-only Ask turn', async () => {
      await writeFile(join(worktree, 'a.txt'), 'read-only\n');
      const outputs: ProviderOutput[] = [];
      for await (const output of codex.run({
        prompt: '#sandboxed git -c user.email=t@t -c user.name=t commit -qam ro && echo COMMITTED',
        history: [],
        projectRoots: [worktree],
        settings: { method: 'cli', model: null, modelLabel: null, effort: null },
        signal: new AbortController().signal,
      })) {
        outputs.push(output);
      }
      const text = replyText(outputs);
      expect(text).toContain('sandbox=read-only');
      expect(text).not.toContain('COMMITTED');
    });
  },
);
