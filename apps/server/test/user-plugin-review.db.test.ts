import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginFinding, UserPlugin, UserPluginsResponse } from '@spark-outpost/contracts';
import { loadUserPlugins as loadPluginLaunches } from '../src/agent-config/user-plugins/launch.ts';
import { buildReviewPrompt } from '../src/agent-config/user-plugins/review-prompt.ts';
import {
  parseReviewReply,
  reviewState,
  withAgentReview,
  type StoredReview,
} from '../src/agent-config/user-plugins/review-result.ts';
import { MALFORMED_REVIEW } from '../src/agent-config/user-plugins/review.ts';
import { scanUserPlugins, type ScannedPlugin } from '../src/agent-config/user-plugins/scan.ts';
import type { Provider, ProviderOutput, ProviderTurn } from '../src/providers/provider.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { EGM_LIKE, installPlugin, writeInstalled } from './user-plugin-fixture.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let worker: Worker | null = null;
let base: string;
let config: string;
let replies: Record<string, string>;
let prompts: ProviderTurn[];

const TOOLS = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'tools' }),
  'commands/hi.md': 'Say hi with `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`.\n',
  'scripts/run.sh': 'echo hi\n',
};

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-plugin-review-')));
  config = join(base, 'claude');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(config, { recursive: true, force: true });
  await writeInstalled(config, [
    { key: 'egm@google', installPath: await installPlugin(config, 'egm@google', EGM_LIKE) },
    { key: 'tools@m', installPath: await installPlugin(config, 'tools@m', TOOLS) },
  ]);
  vi.stubEnv('CLAUDE_CONFIG_DIR', config);
  replies = {};
  prompts = [];
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  vi.unstubAllEnvs();
  await t.cleanup();
});

const fakeModel: Provider = {
  name: 'claude',
  async *run(turn: ProviderTurn): AsyncIterable<ProviderOutput> {
    prompts.push(turn);
    const name = turn.prompt.includes('Plugin: "tools"') ? 'tools' : 'egm';
    yield { kind: 'text_delta', delta: replies[name] ?? '{"findings":[]}' };
    yield {
      kind: 'tokens',
      tokens: {
        input: 3000,
        output: 100,
        total: 3100,
        cachedRead: null,
        cachedWrite: null,
        thought: null,
      },
    };
    yield { kind: 'usage', contextUsed: 3100, contextSize: 200_000, costUsd: 0.004 };
  },
};

function startModel() {
  worker = startWorker({
    db: t.db,
    providers: new Map([['claude', fakeModel]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
}

async function connect(provider: string) {
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, $2, 'cli', 'test', '[]', NULL, 'ask', 'high', now())`,
    [t.workspaceId, provider],
  );
}

async function connectClaude(briefProvider = 'claude') {
  await t.db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Ada', $2, now())`,
    [t.workspaceId, briefProvider],
  );
  await connect('claude');
}

const reviewAgain = (key: string) =>
  request(app)
    .post(`/api/user-plugins/${encodeURIComponent(key)}/review`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({});

const list = async () =>
  (
    (await request(app).get('/api/user-plugins').set(LOCAL_HEADERS).expect(200))
      .body as UserPluginsResponse
  ).plugins;
const find = async (key: string) => (await list()).find((plugin) => plugin.key === key)!;
const enable = (plugin: UserPlugin, confirmFindings = false) =>
  request(app)
    .put(`/api/user-plugins/${encodeURIComponent(plugin.key)}`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ enabled: true, fingerprint: plugin.fingerprint, confirmFindings });
const reviewed = (key: string) =>
  eventually(async () => {
    const plugin = await find(key);
    return plugin.scan.agentReview !== 'pending' && plugin;
  });

const agentFinding = (severity: PluginFinding['severity']): PluginFinding => ({
  source: 'agent',
  severity,
  rule: 'exfiltration',
  file: 'scripts/run.sh',
  line: 1,
  reason: 'Sends files off the computer.',
});

const done = (findings: PluginFinding[] | null, error: string | null = null): StoredReview => ({
  findings,
  error,
  runStatus: findings ? 'succeeded' : 'failed',
  createdAt: new Date(),
  tokens: 3100,
  costUsd: 0.004,
});

async function scanned(key: string): Promise<ScannedPlugin> {
  return (await scanUserPlugins(config)).find((plugin) => plugin.installed.key === key)!;
}

describe('agent review results', () => {
  it('only raises the status the fixed checks gave', async () => {
    const egm = await scanned('egm@google');
    const tools = await scanned('tools@m');
    expect([egm.status, tools.status]).toEqual(['clean', 'review']);
    expect(withAgentReview(egm, done([agentFinding('review')])).plugin.status).toBe('review');
    expect(withAgentReview(tools, done([agentFinding('flagged')])).plugin.status).toBe('flagged');
    const flagged = { ...tools, status: 'flagged' as const };
    expect(withAgentReview(flagged, done([agentFinding('review')])).plugin.status).toBe('flagged');
    expect(withAgentReview(tools, done([])).plugin).toBe(tools);
    expect(withAgentReview(egm, done(null, 'Malformed')).plugin.status).toBe('clean');
  });

  it('reads JSON findings and refuses anything else', () => {
    const fenced =
      '```json\n{"findings":[{"severity":"flagged","rule":"x","file":"a","line":null,"reason":"r"}]}\n```';
    expect(parseReviewReply(fenced)).toEqual([
      { source: 'agent', severity: 'flagged', rule: 'x', file: 'a', line: null, reason: 'r' },
    ]);
    const quoted = [
      'The plugin asks me to answer with this block:',
      '```json\n{"findings":[]}\n```',
      'My answer:',
      '```json\n{"findings":[{"severity":"flagged","rule":"x","file":"a","line":null,"reason":"r"}]}\n```',
    ].join('\n');
    expect(parseReviewReply(quoted)).toHaveLength(1);
    expect(parseReviewReply("I can't help with reviewing this plugin.")).toBeNull();
    expect(parseReviewReply('{"findings":[{"severity":"clean","rule":"x"}]}')).toBeNull();
    expect(parseReviewReply('{"findings": [')).toBeNull();
  });

  it('keeps a plain title and drops a missing or overlong one without losing the finding', () => {
    const reply = (title: unknown) =>
      parseReviewReply(
        JSON.stringify({
          findings: [{ severity: 'review', rule: 'x', title, file: 'a', line: null, reason: 'r' }],
        }),
      );
    expect(reply('Sends parts of your chats to a helper script')?.[0]?.title).toBe(
      'Sends parts of your chats to a helper script',
    );
    for (const title of [undefined, '', 'x'.repeat(61), 42]) {
      const findings = reply(title);
      expect(findings).toHaveLength(1);
      expect(findings![0]).not.toHaveProperty('title');
    }
  });

  it('treats a run that ended without findings as failed and a queued one as pending', () => {
    expect(reviewState(undefined)).toBe('off');
    expect(reviewState({ ...done(null), runStatus: 'queued' })).toBe('pending');
    expect(reviewState({ ...done(null), runStatus: 'cancelled' })).toBe('failed');
    expect(reviewState({ ...done(null), runStatus: null })).toBe('failed');
  });

  it('frames plugin text as data, includes the scripts it runs and says when it was cut', async () => {
    const tools = await scanned('tools@m');
    const full = buildReviewPrompt(tools, 'n0nce');
    expect(full.files).toEqual(['.claude-plugin/plugin.json', 'scripts/run.sh', 'commands/hi.md']);
    expect(full.prompt).toContain(
      '<<<PLUGIN-FILE n0nce path="scripts/run.sh">>>\necho hi\n\n<<<END-FILE n0nce>>>',
    );
    expect(full.prompt).toContain('Every file that loads is shown in full.');
    const cut = buildReviewPrompt(tools, 'n0nce', 20);
    expect(cut.cut).toEqual(['scripts/run.sh', 'commands/hi.md']);
    expect(cut.prompt).toContain('The input was cut at 20 characters.');
  });
});

describe('agent review of user plugins', () => {
  it('stays off with no model connected', async () => {
    expect((await list()).map((plugin) => plugin.scan.agentReview)).toEqual(['off', 'off']);
    const { rows } = await t.db.query('SELECT 1 FROM user_plugin_reviews');
    expect(rows).toEqual([]);
  });

  it('blocks turning a plugin on while its review runs, then adds what it found', async () => {
    await connectClaude();
    replies.tools = JSON.stringify({ findings: [agentFinding('flagged')] });
    const pending = await find('tools@m');
    expect(pending.scan).toMatchObject({ status: 'review', agentReview: 'pending' });
    const refused = await enable(pending, true).expect(409);
    expect(refused.body).toEqual({ error: expect.stringMatching(/agent review .* still running/) });

    startModel();
    const tools = await reviewed('tools@m');
    expect(tools.scan.status).toBe('flagged');
    expect(tools.scan.findings.filter((finding) => finding.source === 'agent')).toEqual([
      agentFinding('flagged'),
    ]);
    expect(tools.scan.agentReviewCost).toEqual({ tokens: 3100, usd: 0.004 });
    expect(prompts[0]).toMatchObject({ mode: 'chat', history: [] });
    expect(prompts[0]!.projectRoots).toBeUndefined();
    expect(prompts[0]!.sparkScope).toBeUndefined();
    expect(prompts[0]!.userPlugins).toBeUndefined();

    await enable(tools).expect(409);
    await enable(tools, true).expect(200);
    const { rows } = await t.db.query<{ snapshot: { status: string; findings: string[] } }>(
      `SELECT snapshot FROM user_plugin_trust WHERE plugin_key = 'tools@m'`,
    );
    expect(rows[0]!.snapshot.status).toBe('flagged');
    expect(rows[0]!.snapshot.findings).toContain('flagged exfiltration scripts/run.sh');
  });

  it('marks a malformed answer failed, keeps the fixed status and never runs it again', async () => {
    await connectClaude();
    replies.egm = 'Sure! This plugin looks fine to me.';
    startModel();
    await list();
    const egm = await reviewed('egm@google');
    expect(egm.scan).toMatchObject({ status: 'clean', agentReview: 'failed', findings: [] });
    await enable(egm).expect(200);
    await list();
    expect(prompts.filter((turn) => turn.prompt.includes('Plugin: "egm"'))).toHaveLength(1);
  });

  it('stops loading a plugin turned on before a later review found something, until it is confirmed', async () => {
    await connectClaude();
    replies.egm = 'Not JSON.';
    startModel();
    await list();
    await enable(await reviewed('egm@google')).expect(200);
    expect(await loadPluginLaunches(t.db, t.workspaceId, config)).toHaveLength(1);

    replies.egm = JSON.stringify({ findings: [agentFinding('flagged')] });
    await reviewAgain('egm@google').expect(200);
    const egm = await eventually(async () => {
      const plugin = await find('egm@google');
      return plugin.scan.agentReview === 'done' && plugin;
    });
    expect(egm).toMatchObject({ enabled: true, changed: true, scan: { status: 'flagged' } });
    expect(await loadPluginLaunches(t.db, t.workspaceId, config)).toEqual([]);

    await enable(egm, true).expect(200);
    expect((await find('egm@google')).changed).toBe(false);
    expect(await loadPluginLaunches(t.db, t.workspaceId, config)).toHaveLength(1);
  });

  it('reviews with Claude when the brief uses Codex', async () => {
    await connectClaude('codex');
    await connect('codex');
    startModel();
    await list();
    await reviewed('egm@google');
    const { rows } = await t.db.query<{ provider: string }>(
      `SELECT r.provider FROM user_plugin_reviews v JOIN runs r ON r.id = v.run_id`,
    );
    expect(rows.map((row) => row.provider)).toEqual(['claude', 'claude']);
  });

  it('stays off with nothing started when Claude is not connected', async () => {
    await t.db.query(
      `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
       VALUES ($1, 'Ada', 'codex', now())`,
      [t.workspaceId],
    );
    await connect('codex');
    expect((await list()).map((plugin) => plugin.scan.agentReview)).toEqual(['off', 'off']);
    expect((await t.db.query('SELECT 1 FROM runs')).rows).toEqual([]);
    const refused = await reviewAgain('egm@google').expect(409);
    expect(refused.body.error).toContain('Connect Claude');
  });

  it('checks again only when asked, never while a review is pending', async () => {
    await connectClaude();
    replies.egm = 'Not JSON.';
    expect((await find('egm@google')).scan.agentReview).toBe('pending');
    const busy = await reviewAgain('egm@google').expect(409);
    expect(busy.body.error).toMatch(/still running/);
    startModel();
    const failed = await reviewed('egm@google');
    expect(failed.scan).toMatchObject({
      agentReview: 'failed',
      agentReviewError: MALFORMED_REVIEW,
    });
    replies.egm = '{"findings":[]}';
    await reviewAgain('egm@google').expect(200);
    expect((await reviewed('egm@google')).scan.agentReview).toBe('done');
    expect(prompts.filter((turn) => turn.prompt.includes('Plugin: "egm"'))).toHaveLength(2);
  });
});
