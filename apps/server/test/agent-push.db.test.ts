import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withdrawTrust } from '../src/agent-config/trust-store.ts';
import { agentEnvironment } from '../src/agents/acp/agent-env.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { insertFinishedRunEntries } from '../src/persistence/audit-log.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import type { ProtocolObserver } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { AGENT_PUSH_METHOD, pushForAgent, type PublishScope } from '../src/ship/agent-push.ts';
import type { GitHubDeps } from '../src/ship/github/access.ts';
import { conversationPushes } from '../src/ship/push-notices.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const NPM_TOKEN = 'npm_Zx91LoginShellOnlyValue77';
const BRANCH = 'spark/notes-1a2b3c4d';

const HOOK = `#!/bin/sh
printf '%s|%s\\n' "$NPM_TOKEN" "$npm_config_userconfig" > "$SEEN_FILE"
if [ -z "$NPM_TOKEN" ] || [ -z "$npm_config_userconfig" ]; then
  echo "npm error code E401" >&2
  echo "npm error Incorrect or missing password." >&2
  echo "husky - pre-push script failed (code 1)" >&2
  exit 1
fi
echo "registry login ok with $NPM_TOKEN"
`;

const SLOW_HOOK = `#!/bin/sh
echo "building" >&2
sleep 30
`;

let t: TestDb;
let base: string;
let root: string;
let seen: string;
let projectId: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);

function installHook(script: string) {
  const hook = path.join(root, '.git', 'hooks', 'pre-push');
  writeFileSync(hook, script);
  chmodSync(hook, 0o755);
}

beforeEach(async () => {
  t = await createTestDb();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-agent-push-')));
  root = path.join(base, 'work');
  seen = path.join(base, 'seen');
  execFileSync('git', ['init', '-q', '--bare', path.join(base, 'remote.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  writeFileSync(path.join(root, 'notes.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('remote', 'add', 'origin', path.join(base, 'remote.git'));
  git('checkout', '-qb', BRANCH);
  installHook(HOOK);
  const linked = await linkedConversation(t, root);
  projectId = linked.projectId;
  const conversationId = linked.conversationId;
  await insertChatWorktree(t.db, {
    id: randomUUID(),
    conversationId,
    projectId,
    repoRoot: root,
    path: root,
    branch: BRANCH,
    baseBranch: 'main',
    baseCommit: 'a'.repeat(40),
    landedCommit: null,
    inPlace: false,
    ownsBranch: true,
  });
});

afterEach(async () => {
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

const loginShell = () => ({
  SEEN_FILE: seen,
  NPM_TOKEN,
  npm_config_userconfig: '/Users/me/.npmrc',
});

function deps(loginEnv: Record<string, string> = loginShell()): GitHubDeps {
  return { db: t.db, workspaceId: t.workspaceId, loginEnv: async () => loginEnv } as GitHubDeps;
}

const scope = (): PublishScope => ({
  basis: 'requested',
  task: { branch: BRANCH, protectedBranches: ['main', 'master'] },
  root,
});

function auditLog() {
  const entries: unknown[] = [];
  const audit = {
    message: (_direction: string, message: unknown) => entries.push(message),
  } as unknown as ProtocolObserver;
  return { audit, entries };
}

const remoteBranches = () =>
  execFileSync('git', ['-C', path.join(base, 'remote.git'), 'branch', '--list'], {
    encoding: 'utf8',
  });

describe(
  "an authorized push of the chat's own branch that Spark runs for the agent",
  {
    timeout: 60_000,
  },
  () => {
    it("gives the pre-push hook the user's login-shell token and npm variables", async () => {
      const { audit, entries } = auditLog();
      const pushed = await pushForAgent(deps(), scope(), { audit });
      expect(pushed).toMatchObject({ outcome: 'pushed', remote: 'origin', secretsWithheld: false });
      expect(readFileSync(seen, 'utf8').trim()).toBe(`${NPM_TOKEN}|/Users/me/.npmrc`);
      expect(remoteBranches()).toContain(BRANCH);
      expect(entries).toHaveLength(1);
    });

    it('never returns or audits the value, even when the hook prints it', async () => {
      const { audit, entries } = auditLog();
      const pushed = await pushForAgent(deps(), scope(), { audit });
      expect(pushed.output).toContain('registry login ok with [hidden]');
      expect(JSON.stringify(pushed)).not.toContain(NPM_TOKEN);
      expect(JSON.stringify(entries)).not.toContain(NPM_TOKEN);
      expect(entries[0]).toMatchObject({
        method: AGENT_PUSH_METHOD,
        params: { outcome: 'pushed', basis: 'requested', secretVariablesPassed: ['NPM_TOKEN'] },
      });
    });

    it('does not push commits that hold a value from a secret file, and names only the file', async () => {
      const value = 'tok_live_9f8e7d6c5b4a3210';
      writeFileSync(path.join(root, '.gitignore'), '.env\n');
      writeFileSync(path.join(root, '.env'), `API_TOKEN=${value}\n`);
      writeFileSync(path.join(root, 'config.ts'), `export const token = '${value}';\n`);
      git('add', '.gitignore', 'config.ts');
      git('commit', '-qm', 'config');
      const { audit, entries } = auditLog();
      const pushed = await pushForAgent(deps(), scope(), { audit });
      expect(pushed).toMatchObject({ outcome: 'refused', remote: 'origin' });
      expect(pushed.message).toContain('a value from .env');
      expect(JSON.stringify([pushed, entries])).not.toContain(value);
      expect(remoteBranches()).not.toContain(BRANCH);
    });

    it("leaves the agent's own shell without the variable", async () => {
      const launched = { ...process.env, ...loginShell(), GH_TOKEN: 'ghp_fromTheUsersShell0000' };
      const env = await agentEnvironment(
        { definition: agentDefinitions.claude, env: childEnvironment(launched) },
        base,
      );
      const shown = execFileSync(
        '/bin/sh',
        ['-c', 'env; printenv NPM_TOKEN; echo "token=[$NPM_TOKEN] gh=[$GH_TOKEN]"'],
        { env, encoding: 'utf8' },
      );
      expect(shown).not.toContain(NPM_TOKEN);
      expect(shown).not.toContain('ghp_fromTheUsersShell0000');
      expect(shown).toContain('token=[] gh=[]');
      expect(shown).toContain('npm_config_userconfig=/Users/me/.npmrc');
    });

    it('withholds token and key variables from the hooks of a folder marked Not trusted', async () => {
      await withdrawTrust(t.db, t.workspaceId, projectId);
      const failed = await pushForAgent(deps(), scope());
      expect(failed).toMatchObject({
        outcome: 'failed',
        stoppedBy: 'pre-push (husky)',
        secretsWithheld: true,
      });
      expect(failed.message).toContain('marked Not trusted');
      expect(failed.output).toContain('npm error code E401');
      expect(readFileSync(seen, 'utf8').trim()).toBe('|/Users/me/.npmrc');
      expect(remoteBranches()).not.toContain(BRANCH);
    });

    it('names the hook and returns its output when the check fails', async () => {
      const failed = await pushForAgent(deps({ SEEN_FILE: seen }), scope());
      expect(failed.outcome).toBe('failed');
      expect(failed.stoppedBy).toBe('pre-push (husky)');
      expect(failed.message).toContain("stopped by this repository's pre-push check");
      expect(failed.output).toContain('Incorrect or missing password');
    });

    it('stops the hook and pushes nothing when the turn is cancelled', async () => {
      installHook(SLOW_HOOK);
      const controller = new AbortController();
      const started = Date.now();
      setTimeout(() => controller.abort(), 500);
      const stopped = await pushForAgent(deps(), scope(), { signal: controller.signal });
      expect(stopped.outcome).toBe('cancelled');
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(remoteBranches()).not.toContain(BRANCH);
    });

    it('gives up on a hook that outlasts the time limit and says so', async () => {
      installHook(SLOW_HOOK);
      const stopped = await pushForAgent(deps(), scope(), { timeoutMs: 4_000 });
      expect(stopped.outcome).toBe('timed_out');
      expect(stopped.message).toContain('without finishing');
      expect(stopped.output).toContain('building');
      expect(remoteBranches()).not.toContain(BRANCH);
    });

    it('lists a stopped push for the chat with the hook and the hidden-value tail', async () => {
      const { conversationId, runId } = await startChat(t, 'Push it');
      const audit = {
        message: (_direction: string, payload: unknown) => {
          saved.push(
            insertFinishedRunEntries(t.db, runId, [
              {
                at: new Date(),
                direction: 'harness',
                kind: 'ship',
                method: AGENT_PUSH_METHOD,
                rpcId: null,
                sizeBytes: 0,
                truncated: false,
                payload,
              },
            ]),
          );
        },
      } as unknown as ProtocolObserver;
      const saved: Promise<void>[] = [];
      await pushForAgent(deps({ SEEN_FILE: seen }), scope(), { audit });
      await pushForAgent(deps(), scope(), { audit });
      await Promise.all(saved);
      const pushes = await conversationPushes(t.db, t.workspaceId, conversationId);
      expect(pushes.map((push) => [push.outcome, push.hook, push.runId])).toEqual([
        ['failed', 'pre-push (husky)', runId],
        ['pushed', null, runId],
      ]);
      expect(pushes[0]!.output).toContain('Incorrect or missing password');
      expect(pushes[1]!.output).toBe('');
      expect(JSON.stringify(pushes)).not.toContain(NPM_TOKEN);
      expect(await conversationPushes(t.db, randomUUID(), conversationId)).toEqual([]);
    });

    it('refuses a protected branch without running git', async () => {
      const refused = await pushForAgent(deps(), {
        ...scope(),
        task: { branch: BRANCH, protectedBranches: [BRANCH] },
      });
      expect(refused.outcome).toBe('refused');
      expect(remoteBranches()).not.toContain(BRANCH);
    });
  },
);
