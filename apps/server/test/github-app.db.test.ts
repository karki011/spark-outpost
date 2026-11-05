import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubAppSignInSchema, providerHealthSchema } from '@spark-outpost/contracts';
import { APP_LOGIN, APP_USER_CODE } from './fake-github-app.ts';
import {
  connection,
  everyRow,
  expectNoSecrets,
  linkedRepo,
  signIn,
  signInState,
  startAppWorld,
  watchConsole,
  type AppWorld,
} from './github-app-support.ts';
import { eventually } from './support.ts';

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

const start = async () =>
  githubAppSignInSchema.parse((await world.post('/api/github/app/sign-in').expect(200)).body);

describe('signing in with the GitHub App', { timeout: 60_000 }, () => {
  it('shows a code, waits at GitHub’s pace, and keeps the tokens only in the keychain', async () => {
    await linkedRepo(world, 'covered');
    const before = await connection(world);
    expect(before.app).toMatchObject({
      available: true,
      state: 'signed_out',
      installUrl: 'https://github.com/apps/spark-outpost-test/installations/new',
    });

    const app = world.stub.github.app;
    app.beforeDecision = ['authorization_pending', 'slow_down'];
    const waiting = await start();
    expect(waiting).toMatchObject({
      status: 'waiting',
      userCode: APP_USER_CODE,
      verificationUri: 'https://github.com/login/device',
    });
    await eventually(async () => app.polls >= 2, 10_000);
    expect((await signInState(world)).status).toBe('waiting');

    app.decision = 'approved';
    await eventually(async () => (await signInState(world)).status === 'connected', 10_000);
    expect(world.sleeps.slice(0, 3)).toEqual([1000, 1000, 2000]);
    expect(await signInState(world)).toMatchObject({ status: 'connected', userCode: null });

    const status = await connection(world);
    expect(status.active).toBe('app');
    expect(status.app).toMatchObject({
      state: 'connected',
      login: APP_LOGIN,
      repos: ['acme/widgets'],
      projects: [{ project: 'covered', repo: 'acme/widgets', covered: true }],
    });
    expect(await world.secrets.get('github-app')).toContain(app.issued[0]);
    expectNoSecrets(await everyRow(world.t), world);
    expectNoSecrets(JSON.stringify(status), world);
    expectNoSecrets(logs.text(), world);
  });

  it('runs one flow at a time and stops when cancelled', async () => {
    const app = world.stub.github.app;
    const first = await start();
    const second = await start();
    expect(second).toEqual(first);
    expect(app.deviceCodes).toBe(1);

    const cancelled = githubAppSignInSchema.parse(
      (await world.del('/api/github/app/sign-in').expect(200)).body,
    );
    expect(cancelled).toMatchObject({ status: 'idle', userCode: null });
    app.decision = 'approved';
    const polls = app.polls;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.polls).toBeLessThanOrEqual(polls + 1);
    expect(app.issued).toEqual([]);
    expect((await connection(world)).app.state).toBe('signed_out');
    expect(await world.secrets.get('github-app')).toBeNull();
  });

  it.each([
    ['expired', /ran out/],
    ['denied', /cancelled on GitHub/],
  ] as const)('ends plainly when the code is %s', async (decision, message) => {
    world.stub.github.app.decision = decision;
    await start();
    await eventually(async () => (await signInState(world)).status === decision, 10_000);
    expect((await signInState(world)).message).toMatch(message);
    expect((await connection(world)).app.state).toBe('signed_out');
  });

  it('says what to fix when the app has device flow turned off', async () => {
    world.stub.github.app.deviceFlowDisabled = true;
    const response = await world.post('/api/github/app/sign-in').expect(502);
    expect(response.body.error).toMatch(/Enable Device Flow/);
    expect(await signInState(world)).toMatchObject({ status: 'failed' });
  });

  it('lists every page of repositories and re-checks coverage on request', async () => {
    const app = world.stub.github.app;
    app.repos = Array.from({ length: 230 }, (_, index) => `acme/repo-${index}`);
    await linkedRepo(world, 'uncovered');
    await signIn(world);
    const first = await connection(world);
    expect(first.app.repos).toHaveLength(230);
    expect(first.app.projects).toEqual([
      { project: 'uncovered', repo: 'acme/widgets', covered: false },
    ]);

    app.repos.push('Acme/Widgets');
    const rechecked = (await world.post('/api/github/app/repos').expect(200)).body;
    expect(rechecked.app.projects).toEqual([
      { project: 'uncovered', repo: 'acme/widgets', covered: true },
    ]);
  });

  it('disconnects by deleting the keychain entry and the connection', async () => {
    await signIn(world);
    const health = async () =>
      providerHealthSchema.parse((await world.get('/api/providers/health').expect(200)).body);
    expect((await health()).githubSignInNeeded).toBe(false);
    const after = (await world.del('/api/github/app').expect(200)).body;
    expect(after).toMatchObject({ active: null, app: { state: 'signed_out', login: null } });
    expect(await world.secrets.get('github-app')).toBeNull();
    const { rowCount } = await world.t.db.query('SELECT 1 FROM github_app_connections');
    expect(rowCount).toBe(0);
  });
});

describe('a build without a GitHub App client ID', { timeout: 60_000 }, () => {
  it('hides the sign-in and leaves the token flow alone', async () => {
    const plain = await startAppWorld({ configured: false });
    try {
      expect((await connection(plain)).app).toMatchObject({ available: false });
      await plain.post('/api/github/app/sign-in').expect(400);
      expect(plain.stub.github.app.deviceCodes).toBe(0);
    } finally {
      await plain.close();
    }
  });
});
