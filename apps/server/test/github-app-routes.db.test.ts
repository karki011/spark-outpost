import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chatPrRouteSchema,
  githubTestResultSchema,
  providerHealthSchema,
} from '@spark-outpost/contracts';
import { connectionFor } from '../src/ship/github/access.ts';
import { appAccessToken } from '../src/ship/github/app-tokens.ts';
import { APP_LOGIN } from './fake-github-app.ts';
import {
  connection,
  editedTask,
  everyRow,
  expectNoSecrets,
  linkedRepo,
  ship,
  signIn,
  startAppWorld,
  watchConsole,
  type AppWorld,
} from './github-app-support.ts';
import { git } from './ship-support.ts';

const WIDGETS = { host: 'github.com', owner: 'acme', name: 'widgets' };
const HOURS = 60 * 60_000;
const PAT = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop';

let world: AppWorld;
let logs: ReturnType<typeof watchConsole>;

beforeEach(async () => {
  world = await startAppWorld();
  logs = watchConsole();
});

afterEach(async () => {
  logs.restore();
  await world.close();
});

const route = async (conversationId: string) =>
  chatPrRouteSchema.parse((await world.get(`/api/conversations/${conversationId}/pr-route`)).body)
    .info?.route;

async function shipAudit() {
  const { rows } = await world.t.db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM run_protocol_log WHERE kind = 'ship' ORDER BY at DESC LIMIT 1`,
  );
  return rows[0]?.payload ?? null;
}

async function refuseGitLogin(bare: string) {
  const hook = path.join(bare, 'hooks', 'pre-receive');
  await writeFile(
    hook,
    `#!/bin/sh
if [ -n "$GIT_ASKPASS" ]; then
  user="$("$GIT_ASKPASS" 'Username for https://github.com:')"
  pass="$("$GIT_ASKPASS" 'Password for https://github.com:')"
  case "$user:$pass" in x-access-token:ghu_*) exit 0 ;; esac
fi
echo "fatal: Authentication failed for 'https://github.com/acme/widgets.git/'" >&2
exit 1
`,
  );
  await chmod(hook, 0o755);
}

describe('the GitHub App token lifecycle', { timeout: 60_000 }, () => {
  it('refreshes once before expiry however many callers ask, and rotates the refresh token', async () => {
    await signIn(world);
    const app = world.stub.github.app;
    const first = await world.secrets.get('github-app');
    const later = world.deps(() => Date.now() + 8 * HOURS);
    const tokens = await Promise.all(Array.from({ length: 6 }, () => appAccessToken(later)));
    expect(app.refreshes).toBe(1);
    expect(new Set(tokens)).toEqual(new Set([app.issued[1]]));
    const stored = await world.secrets.get('github-app');
    expect(stored).not.toBe(first);
    expect(stored).toContain('ghr_fakeRefresh0002');

    expect(await appAccessToken(world.deps())).toBe(app.issued[1]);
    expect(app.refreshes).toBe(1);
    expectNoSecrets(await everyRow(world.t), world);
    expectNoSecrets(logs.text(), world);
  });

  it('refreshes after a 401 and repeats the call', async () => {
    await signIn(world);
    const app = world.stub.github.app;
    app.revokeAccess();
    const github = await connectionFor(world.deps(), WIDGETS);
    expect(github?.method).toBe('app');
    expect(await github!.whoami()).toEqual({ login: APP_LOGIN });
    expect(app.refreshes).toBe(1);
  });

  it('asks for a new sign-in when the refresh token is refused, and falls back to gh', async () => {
    const repo = await linkedRepo(world, 'fallback');
    await writeFile(world.ghState, 'octo-cli');
    await signIn(world);
    const app = world.stub.github.app;
    app.rejectRefresh = true;
    app.revokeAccess();

    const { taskId, conversationId } = await editedTask(world, repo.root);
    const result = await ship(world, taskId);
    expect(result.pullRequest?.created).toBe(true);
    expect(world.stub.github.pulls[0]).toMatchObject({ via: 'gh_cli', openedBy: 'octo-cli' });

    const status = await connection(world);
    expect(status.active).toBe('gh_cli');
    expect(status.app).toMatchObject({ state: 'needs_sign_in', login: APP_LOGIN });
    const health = providerHealthSchema.parse((await world.get('/api/providers/health')).body);
    expect(health.githubSignInNeeded).toBe(true);
    expect(await connectionFor(world.deps(), WIDGETS)).toMatchObject({ method: 'gh_cli' });
    expect(await route(conversationId)).not.toBe('app');
    expect(app.refreshes).toBe(1);

    app.rejectRefresh = false;
    await signIn(world);
    expect((await connection(world)).app.state).toBe('connected');
  });
});

describe('the route chain with the GitHub App', { timeout: 60_000 }, () => {
  it('opens the pull request as the user through the app before a token or gh', async () => {
    const repo = await linkedRepo(world, 'app-first');
    await writeFile(world.ghState, 'octo-cli');
    await signIn(world);
    const { taskId, conversationId } = await editedTask(world, repo.root);
    expect(await route(conversationId)).toBe('app');

    const result = await ship(world, taskId);
    expect(result.pullRequest?.created).toBe(true);
    expect(world.stub.github.pulls[0]).toMatchObject({ via: 'app', openedBy: APP_LOGIN });

    const tested = githubTestResultSchema.parse((await world.post('/api/github/test')).body);
    expect(tested.projects[0]).toMatchObject({ route: 'app', reach: 'git' });
    expect(tested.projects[0]!.detail).toContain(`as ${APP_LOGIN}`);
    expectNoSecrets(await everyRow(world.t), world);
  });

  it('uses the app only for repositories it covers', async () => {
    const repo = await linkedRepo(world, 'elsewhere');
    git(repo.root, 'remote', 'set-url', 'origin', 'https://github.com/acme/elsewhere.git');
    git(repo.root, 'config', 'remote.origin.pushurl', repo.bare);
    await signIn(world);
    const { conversationId, taskId } = await editedTask(world, repo.root);
    expect(await route(conversationId)).toBe('link');
    const status = await connection(world);
    expect(status.app.projects).toEqual([
      { project: 'elsewhere', repo: 'acme/elsewhere', covered: false },
    ]);

    const result = await ship(world, taskId);
    expect(result.pullRequest).toBeNull();
    expect(result.prLink?.url).toContain('/acme/elsewhere/compare/');
    expect(world.stub.github.requests.filter((entry) => entry.via === 'app')).not.toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('/repos/acme/elsewhere') }),
    );

    world.stub.github.app.repos.push('acme/elsewhere');
    await world.post('/api/github/app/repos').expect(200);
    expect(await route(conversationId)).toBe('app');
  });

  it('pushes over HTTPS with the app token through the one-shot askpass, without leaking it', async () => {
    const repo = await linkedRepo(world, 'askpass');
    await signIn(world);
    await refuseGitLogin(repo.bare);
    const { taskId } = await editedTask(world, repo.root);
    const result = await ship(world, taskId);
    expect(result.pushed).toBe(true);
    const audit = await shipAudit();
    expect(audit).toMatchObject({ pushedWith: 'app' });
    expectNoSecrets(JSON.stringify(audit), world);
    expectNoSecrets(git(repo.root, 'config', '--list'), world);
    expectNoSecrets(await everyRow(world.t), world);
    expectNoSecrets(logs.text(), world);
  });

  it('keeps the personal token as the next choice after a disconnect', async () => {
    const repo = await linkedRepo(world, 'token-next');
    await signIn(world);
    expect((await connection(world)).active).toBe('app');
    await world.secrets.set('github', PAT);
    await world.t.db.query(
      `INSERT INTO github_tokens (workspace_id, host, login) VALUES ($1, 'github.com', 'octo-token')`,
      [world.t.workspaceId],
    );
    const { conversationId } = await editedTask(world, repo.root);
    expect(await route(conversationId)).toBe('app');
    await world.del('/api/github/app').expect(200);
    expect(await route(conversationId)).toBe('token');
    expect((await connection(world)).active).toBe('token');
  });
});
