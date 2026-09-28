import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VerifyEvent } from '@spark-outpost/contracts';
import type { RunCommand } from '../src/setup/command.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const VALID_CLAUDE_KEY = `sk-ant-api03-${'x'.repeat(24)}4f2a`;
const VALID_OPENAI_KEY = `sk-proj-${'y'.repeat(24)}9k1z`;

let t: TestDb;
let secrets: SecretStore;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
});

afterEach(async () => {
  await t.cleanup();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const anthropicModels = {
  data: [
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
  ],
};

function appWith(options: { fetch?: typeof fetch; runCommand?: RunCommand } = {}) {
  const app = createTestApp(t, { ...options, secrets });
  const send = (method: 'post' | 'patch' | 'delete', path: string, body: object = {}) =>
    request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
  return {
    get: (path: string) => request(app).get(path).set(LOCAL_HEADERS),
    send,
    async verify(provider: string, body: object): Promise<VerifyEvent[]> {
      const response = await send('post', `/api/providers/${provider}/verify`, body).expect(200);
      return response.text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as VerifyEvent);
    },
  };
}

describe('setup state', () => {
  it('starts with no name, no connections, and onboarding not completed', async () => {
    const { body } = await appWith().get('/api/setup').expect(200);
    expect(body.profile).toEqual({
      displayName: '',
      defaultProvider: null,
      onboardingCompleted: false,
      autoContinueSeconds: 10,
      jevDiffs: true,
      shipFailingChecks: true,
    });
    expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual([
      'claude',
      'codex',
      'zai',
    ]);
    expect(
      body.providers.every((provider: { connection: unknown }) => provider.connection === null),
    ).toBe(true);
  });

  it('saves the display name and refuses to finish setup without a provider', async () => {
    const app = appWith();
    const { body } = await app
      .send('patch', '/api/profile', { displayName: '  Hazel Morgan ' })
      .expect(200);
    expect(body.profile.displayName).toBe('Hazel Morgan');
    await app.send('patch', '/api/profile', { onboardingCompleted: true }).expect(400);
  });
});

describe('API key verification', () => {
  it('connects Claude, stores the key only in the secret store, and reports real models', async () => {
    const requests: Request[] = [];
    const app = appWith({
      fetch: async (input) => {
        requests.push(input as Request);
        return jsonResponse(200, anthropicModels);
      },
    });

    const events = await app.verify('claude', { method: 'api_key', apiKey: VALID_CLAUDE_KEY });

    expect(
      events.filter((event) => event.type !== 'step_started').map((event) => event.type),
    ).toEqual(['step_succeeded', 'step_succeeded', 'step_succeeded', 'connected']);
    expect(events).toContainEqual({
      type: 'step_succeeded',
      label: 'Opus, Sonnet, and Haiku are available',
    });
    expect(requests[0]?.headers.get('x-api-key')).toBe(VALID_CLAUDE_KEY);
    expect(await secrets.get('claude')).toBe(VALID_CLAUDE_KEY);

    const { body } = await app.get('/api/setup');
    const claude = body.providers[0];
    expect(claude.connection).toMatchObject({
      method: 'api_key',
      detail: 'sk-ant-…4f2a',
      model: 'claude-opus-5-5',
      permission: 'do',
      agentMode: 'default',
      level: 'hands-off',
      effort: 'medium',
    });
    expect(JSON.stringify(body)).not.toContain(VALID_CLAUDE_KEY);
    const stored = await t.db.query('SELECT * FROM provider_connections');
    expect(JSON.stringify(stored.rows)).not.toContain(VALID_CLAUDE_KEY);
  });

  it('reports a rejected key and keeps nothing', async () => {
    const app = appWith({ fetch: async () => jsonResponse(401, { error: 'invalid' }) });
    const events = await app.verify('claude', { method: 'api_key', apiKey: VALID_CLAUDE_KEY });

    expect(events.at(-1)).toEqual({
      type: 'step_failed',
      label:
        "Anthropic rejected this key (401 Unauthorized). Check that it's active and copied in full.",
    });
    expect(await secrets.get('claude')).toBeNull();
    expect((await app.get('/api/setup')).body.providers[0].connection).toBeNull();
  });

  it('explains when the provider cannot be reached', async () => {
    const events = await appWith().verify('codex', { method: 'api_key', apiKey: VALID_OPENAI_KEY });
    expect(events.at(-1)?.type).toBe('step_failed');
    expect(events.at(-1)).toMatchObject({
      label: expect.stringContaining("Couldn't reach OpenAI"),
    });
  });

  it('rejects a malformed key before any network call', async () => {
    let called = false;
    const app = appWith({
      fetch: async () => {
        called = true;
        return jsonResponse(200, anthropicModels);
      },
    });
    const events = await app.verify('codex', { method: 'api_key', apiKey: VALID_CLAUDE_KEY });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining('Anthropic key'),
    });
    expect(called).toBe(false);
  });
});

describe('local CLI verification', () => {
  it('explains how to install a missing CLI', async () => {
    const events = await appWith().verify('codex', { method: 'cli' });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining('npm i -g @openai/codex'),
      code: 'cli_missing',
    });
  });

  it('connects Claude when the CLI is found and logged in, without spending a request', async () => {
    const calls: string[][] = [];
    const runCommand: RunCommand = async (file, args) => {
      calls.push(args);
      if (file === '/usr/bin/which')
        return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      if (args[0] === '--version')
        return { code: 0, stdout: '2.1.282 (Claude Code)\n', stderr: '' };
      return {
        code: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'me@example.com',
        }),
        stderr: '',
      };
    };
    const app = appWith({ runCommand });
    const events = await app.verify('claude', { method: 'cli' });

    expect(events).toContainEqual({
      type: 'step_succeeded',
      label: 'Found `claude 2.1.282` at `/usr/local/bin/claude`',
    });
    expect(events).toContainEqual({
      type: 'step_succeeded',
      label: 'Logged in with your Claude account',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'connected',
      connection: { method: 'cli', detail: 'claude 2.1.282' },
    });
    expect(calls.some((args) => args.includes('-p'))).toBe(false);
    expect(JSON.stringify(events)).not.toContain('me@example.com');
  });

  it('asks a logged-out user to run claude auth login', async () => {
    const runCommand: RunCommand = async (file, args) => {
      if (file === '/usr/bin/which')
        return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      if (args[0] === 'auth')
        return { code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: '' };
      return { code: 0, stdout: '2.1.282\n', stderr: '' };
    };
    const events = await appWith({ runCommand }).verify('claude', { method: 'cli' });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining('claude auth login'),
      code: 'not_logged_in',
    });
  });

  it('falls back to a test request on CLIs without a login status command', async () => {
    const runCommand: RunCommand = async (file, args) => {
      if (file === '/usr/bin/which')
        return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      if (args[0] === 'auth')
        return { code: 1, stdout: '', stderr: "error: unknown command 'auth'" };
      if (args[0] === '-p')
        return { code: 0, stdout: JSON.stringify({ is_error: false }), stderr: '' };
      return { code: 0, stdout: '1.0.0\n', stderr: '' };
    };
    const events = await appWith({ runCommand }).verify('claude', { method: 'cli' });
    expect(events).toContainEqual({ type: 'step_started', label: 'Sending a test request' });
    expect(events.at(-1)).toMatchObject({ type: 'connected' });
  });

  it('finds a CLI that is only on the login shell PATH', async () => {
    const runCommand: RunCommand = async (file, args) => {
      if (file === '/usr/bin/which') return { code: 1, stdout: '', stderr: '' };
      if (args[0] === '-ilc') {
        return { code: 0, stdout: 'Welcome back\n/Users/me/.npm-global/bin/codex\n', stderr: '' };
      }
      if (args[0] === '--version') return { code: 0, stdout: 'codex-cli 0.46.0\n', stderr: '' };
      return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
    };
    const events = await appWith({ runCommand }).verify('codex', { method: 'cli' });
    expect(events).toContainEqual({
      type: 'step_succeeded',
      label: 'Found `codex 0.46.0` at `/Users/me/.npm-global/bin/codex`',
    });
    expect(events).toContainEqual({ type: 'step_succeeded', label: 'Logged in using ChatGPT' });
    expect(events.at(-1)).toMatchObject({ type: 'connected' });
  });

  it('reports a failed fallback test request as a login problem', async () => {
    const runCommand: RunCommand = async (file) =>
      file === '/usr/bin/which'
        ? { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' }
        : { code: 1, stdout: '', stderr: 'Not logged in' };
    const events = await appWith({ runCommand }).verify('claude', { method: 'cli' });
    expect(events.at(-1)).toMatchObject({
      type: 'step_failed',
      label: expect.stringContaining('claude auth login'),
    });
  });
});

describe('connections and defaults', () => {
  async function connectBoth() {
    const app = appWith({
      fetch: async (input) =>
        (input as Request).url.includes('anthropic')
          ? jsonResponse(200, anthropicModels)
          : jsonResponse(200, { data: [{ id: 'gpt-5-codex' }, { id: 'gpt-5' }, { id: 'tts-1' }] }),
    });
    await app.verify('claude', { method: 'api_key', apiKey: VALID_CLAUDE_KEY });
    await app.verify('codex', { method: 'api_key', apiKey: VALID_OPENAI_KEY });
    return app;
  }

  it('updates defaults only to values the provider offers', async () => {
    const app = await connectBoth();
    await app
      .send('patch', '/api/providers/claude/defaults', { model: 'claude-sonnet-5', effort: 'max' })
      .expect(200);
    await app.send('patch', '/api/providers/claude/defaults', { model: 'gpt-5' }).expect(400);
    await app.send('patch', '/api/providers/codex/defaults', { effort: 'max' }).expect(400);

    const { body } = await app.get('/api/setup');
    expect(body.providers[0].connection).toMatchObject({ model: 'claude-sonnet-5', effort: 'max' });
    expect(body.providers[1].connection.models).toEqual([
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
    ]);
  });

  it('disconnects any provider, removes its key, and sends the user back to setup when none are left', async () => {
    const app = await connectBoth();
    await app
      .send('patch', '/api/profile', { defaultProvider: 'codex', onboardingCompleted: true })
      .expect(200);

    await app.send('delete', '/api/providers/codex/connection').expect(200);
    expect(await secrets.get('codex')).toBeNull();
    const { body } = await app.get('/api/setup');
    expect(body.profile).toMatchObject({ defaultProvider: 'claude', onboardingCompleted: true });

    await app.send('delete', '/api/providers/claude/connection').expect(200);
    expect(await secrets.get('claude')).toBeNull();
    const after = await app.get('/api/setup');
    expect(after.body.profile).toMatchObject({ defaultProvider: null, onboardingCompleted: false });
    expect(
      after.body.providers.every(
        (provider: { connection: unknown }) => provider.connection === null,
      ),
    ).toBe(true);
  });
});

describe('test messages', () => {
  const claudeCli =
    (reply: { code: number; stdout: string; stderr?: string }): RunCommand =>
    async (file, args) => {
      if (file === '/usr/bin/which')
        return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      if (args[0] === '--version')
        return { code: 0, stdout: '2.1.282 (Claude Code)\n', stderr: '' };
      if (args[0] === 'auth') {
        return {
          code: 0,
          stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
          stderr: '',
        };
      }
      return { stderr: '', ...reply };
    };

  it('sends a test message through the Claude CLI and records the answer', async () => {
    const app = appWith({
      runCommand: claudeCli({
        code: 0,
        stdout: JSON.stringify({
          is_error: false,
          result: 'OK',
          modelUsage: { 'claude-opus-5-5': {} },
        }),
      }),
    });
    await app.verify('claude', { method: 'cli' });
    const before = (await app.get('/api/setup')).body.providers[0].connection;
    expect(before).toMatchObject({ summary: 'Logged in with your Claude account', lastTest: null });

    const { body } = await app.send('post', '/api/providers/claude/test').expect(200);
    expect(body.providers[0].connection.lastTest).toMatchObject({
      ok: true,
      message: expect.stringMatching(/^Test message answered in \d+\.\d s by claude-opus-5-5$/),
    });
  });

  it('records the reason when the test message fails', async () => {
    const app = appWith({
      runCommand: claudeCli({
        code: 1,
        stdout: JSON.stringify({ is_error: true, result: 'Usage limit reached.' }),
      }),
    });
    await app.verify('claude', { method: 'cli' });
    const { body } = await app.send('post', '/api/providers/claude/test').expect(200);
    expect(body.providers[0].connection.lastTest).toMatchObject({
      ok: false,
      message: 'The test message failed: Usage limit reached.',
    });
  });

  it('uses the stored key and the chosen model for API key connections', async () => {
    const requests: Request[] = [];
    const app = appWith({
      fetch: async (input) => {
        const req = input as Request;
        requests.push(req);
        if (req.url.endsWith('/v1/messages'))
          return jsonResponse(200, { model: 'claude-opus-5-5', content: [] });
        return jsonResponse(200, anthropicModels);
      },
    });
    await app.verify('claude', { method: 'api_key', apiKey: VALID_CLAUDE_KEY });
    const { body } = await app.send('post', '/api/providers/claude/test').expect(200);

    const sent = requests.at(-1)!;
    expect(sent.headers.get('x-api-key')).toBe(VALID_CLAUDE_KEY);
    expect(await sent.json()).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16 });
    expect(body.providers[0].connection.lastTest).toMatchObject({ ok: true });
  });

  it('clears the last test when the provider is verified again', async () => {
    const app = appWith({
      runCommand: claudeCli({ code: 0, stdout: JSON.stringify({ is_error: false }) }),
    });
    await app.verify('claude', { method: 'cli' });
    await app.send('post', '/api/providers/claude/test').expect(200);
    await app.verify('claude', { method: 'cli' });
    expect((await app.get('/api/setup')).body.providers[0].connection.lastTest).toBeNull();
  });

  const codexCli =
    (exec: { code: number; stdout: string; timedOut?: boolean }): RunCommand =>
    async (file, args) => {
      if (file === '/usr/bin/which')
        return { code: 0, stdout: '/usr/local/bin/codex\n', stderr: '' };
      if (args[0] === '--version') return { code: 0, stdout: 'codex-cli 0.157.0\n', stderr: '' };
      if (args[0] === 'exec') return { stderr: '', ...exec };
      return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
    };

  it('sends a read-only, throwaway test message through the Codex CLI', async () => {
    const calls: string[][] = [];
    const run = codexCli({
      code: 0,
      stdout: [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'OK' } }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 10 },
          model: 'gpt-5-codex',
        }),
      ].join('\n'),
    });
    const app = appWith({
      runCommand: async (file, args, timeout) => {
        calls.push(args);
        return run(file, args, timeout);
      },
    });
    await app.verify('codex', { method: 'cli' });
    const { body } = await app.send('post', '/api/providers/codex/test').expect(200);

    const exec = calls.find((args) => args[0] === 'exec')!;
    expect(exec).toEqual(
      expect.arrayContaining(['--ephemeral', '-s', 'read-only', '--json', '--skip-git-repo-check']),
    );
    expect(body.providers[1].connection.lastTest).toMatchObject({
      ok: true,
      message: expect.stringMatching(/ by gpt-5-codex$/),
    });
  });

  it('fails a Codex test that times out or ends without a reply', async () => {
    const timedOut = appWith({
      runCommand: codexCli({ code: 0, stdout: '', timedOut: true }),
    });
    await timedOut.verify('codex', { method: 'cli' });
    const late = await timedOut.send('post', '/api/providers/codex/test').expect(200);
    expect(late.body.providers[1].connection.lastTest).toMatchObject({
      ok: false,
      message: "The test message failed: `codex` didn't answer within 90 seconds.",
    });

    const silent = appWith({
      runCommand: codexCli({
        code: 0,
        stdout: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1 } }),
      }),
    });
    await silent.verify('codex', { method: 'cli' });
    const quiet = await silent.send('post', '/api/providers/codex/test').expect(200);
    expect(quiet.body.providers[1].connection.lastTest).toMatchObject({
      ok: false,
      message: 'The test message failed: `codex` finished without replying.',
    });
  });

  it('reports a Codex error event as a failed test', async () => {
    const app = appWith({
      runCommand: codexCli({
        code: 0,
        stdout: JSON.stringify({ type: 'error', message: 'You have hit your usage limit.' }),
      }),
    });
    await app.verify('codex', { method: 'cli' });
    const { body } = await app.send('post', '/api/providers/codex/test').expect(200);
    expect(body.providers[1].connection.lastTest).toMatchObject({
      ok: false,
      message: 'The test message failed: You have hit your usage limit.',
    });
  });
});
