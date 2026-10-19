import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPARK_ACTION_OPTION, type BrowserHostRequest } from '@spark-outpost/contracts';
import { BrowserHostError } from '../src/browser/host-client.ts';
import { createSignIn, updateSignIn } from '../src/browser/sign-ins.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { macOnlyCard } from '../src/remote/policy.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { SIGN_IN_HIDDEN } from '../src/spark-mcp/tools/browser/scrub.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import { PLANTED, everyStoredValue, plantedIn } from './sign-in-support.ts';
import { ECHO, FILE_SECRET, FakeBrowserHost, ORIGIN } from './spark-browser-sign-in-fake.ts';
import {
  connectClient,
  fullAutoChat,
  pendingCard,
  recordedHooks,
  toolDeps,
  type RecordedHooks,
} from './spark-mcp-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let host: SparkMcpHost | null = null;
let clients: Client[] = [];
let recorded: RecordedHooks;
let fake: FakeBrowserHost;
let secrets: SecretStore;
let projectId: string;
let logged: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  fake = new FakeBrowserHost();
  secrets = memorySecretStore();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-sign-in-tool-')));
  mkdirSync(path.join(base, 'site'));
  writeFileSync(path.join(base, 'site', '.env'), `STRIPE_SECRET_KEY=${FILE_SECRET}\n`);
  logged = (['log', 'info', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
  host = await startSparkMcpHost(toolDeps(t, { browser: fake, secrets }));
});

afterEach(async () => {
  recorded.stop();
  for (const client of clients) await client.close();
  clients = [];
  await host?.close();
  host = null;
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

interface Chat {
  conversationId: string;
  runId: string;
  results: string[];
  call(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

async function chatIn(conversationId: string, mode = 'default'): Promise<Chat> {
  const runId = await sendDo(t, conversationId, 'Sign in and check the dashboard');
  await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
    runId,
    mode,
  ]);
  const client = await connectClient(
    await host!.grant({
      workspaceId: t.workspaceId,
      conversationId,
      runId,
      actions: recorded.hooks,
    }),
  );
  clients.push(client);
  const results: string[] = [];
  return {
    conversationId,
    runId,
    results,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const texts = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
      results.push(JSON.stringify(result));
      return result.isError
        ? { error: texts[0] }
        : (JSON.parse(texts[0] ?? '{}') as Record<string, unknown>);
    },
  };
}

async function projectChat(mode?: string): Promise<Chat> {
  const linked = await linkedConversation(t, path.join(base, 'site'));
  projectId = linked.projectId;
  return chatIn(linked.conversationId, mode);
}

async function anotherChat(): Promise<Chat> {
  const linked = await linkedConversation(t, path.join(base, 'site'));
  return chatIn(linked.conversationId);
}

const save = (label = 'Staging admin', origin = ORIGIN) =>
  createSignIn({ db: t.db, secrets }, projectId, { label, origin, ...PLANTED });

async function decide(optionId: string) {
  const card = await pendingCard(t);
  await decideApproval(t.db, t.workspaceId, card.id, { optionId, scope: 'once' });
  return card;
}

async function signInAllowing(chat: Chat, signIn = 'Staging admin') {
  const calling = chat.call('spark_browser_sign_in', { signIn });
  const card = await decide(SPARK_ACTION_OPTION.confirm);
  return { result: await calling, card };
}

async function cardCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: string }>(
    `SELECT count(*) FROM approvals WHERE kind = 'spark_action'`,
  );
  return Number(rows[0]!.count);
}

function signInAudits() {
  return (recorded.audited as { method: string; params: Record<string, unknown> }[])
    .filter((entry) => entry.method === 'spark/browser' && entry.params.action === 'sign_in')
    .map((entry) => entry.params);
}

describe('spark_browser_signins', () => {
  it('lists the label and the site, and no username', async () => {
    const chat = await projectChat();
    const saved = await save();
    const listed = await chat.call('spark_browser_signins');
    expect(listed.signIns).toEqual([{ id: saved.id, label: 'Staging admin', sites: [ORIGIN] }]);
    expect(plantedIn(chat.results.join('\n'))).toEqual([]);
    expect(chat.results.join('\n')).not.toContain('v•••');
  });

  it('is offered with the sign-in tool whenever the browser is there', async () => {
    const chat = await projectChat();
    expect((await chat.call('spark_browser_signins')).signIns).toEqual([]);
    const { tools } = await clients[0]!.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['spark_browser_signins', 'spark_browser_sign_in']),
    );
  });
});

describe('spark_browser_sign_in', () => {
  it('asks the user on a card the first time, then has the browser fill the page', async () => {
    const chat = await projectChat();
    await save();
    const { result, card } = await signInAllowing(chat);
    expect(card.title).toBe(`Sign in to ${ORIGIN} as Staging admin?`);
    expect(card.payload.sparkAction).toMatchObject({
      action: 'browser_sign_in',
      label: 'Staging admin',
      origin: ORIGIN,
      site: ORIGIN,
      sites: [ORIGIN],
    });
    expect(result).toMatchObject({
      outcome: 'form_submitted',
      signIn: 'Staging admin',
      tab: 'tab1',
      page: `${ORIGIN}/home`,
      steps: 1,
    });
    expect(fake.ops('sign_in')).toEqual([
      expect.objectContaining({ tab: 'tab1', sites: [ORIGIN], ...PLANTED }),
    ]);
  });

  it('asks once per chat and per sign-in', async () => {
    const chat = await projectChat();
    await save();
    await save('Staging viewer');
    await signInAllowing(chat);
    expect(await chat.call('spark_browser_sign_in', { signIn: 'staging ADMIN' })).toMatchObject({
      outcome: 'form_submitted',
    });
    expect(await cardCount()).toBe(1);

    await signInAllowing(chat, 'Staging viewer');
    expect(await cardCount()).toBe(2);

    await signInAllowing(await anotherChat());
    expect(await cardCount()).toBe(3);
    expect(signInAudits().map((entry) => entry.decision)).toEqual([
      'user_allowed',
      'allowed_earlier',
      'user_allowed',
      'user_allowed',
    ]);
  });

  it('asks in Bypass permissions and Full auto too', async () => {
    const chat = await projectChat('bypassPermissions');
    await fullAutoChat(t, chat.conversationId);
    await save();
    const { result, card } = await signInAllowing(chat);
    expect(card.decidedBy ?? 'user').toBe('user');
    expect(result.outcome).toBe('form_submitted');
  });

  it('fills nothing when the user says no', async () => {
    const chat = await projectChat();
    await save();
    const calling = chat.call('spark_browser_sign_in', { signIn: 'Staging admin' });
    await decide(SPARK_ACTION_OPTION.decline);
    expect(await calling).toMatchObject({ outcome: 'declined', site: ORIGIN });
    expect(fake.ops('sign_in')).toEqual([]);
    expect(signInAudits()).toEqual([
      expect.objectContaining({ decision: 'user_declined', by: 'user', signIn: 'Staging admin' }),
    ]);
  });

  it.each([
    ['another site', 'https://other.example.com/login'],
    ['a look-alike host', 'https://staging.example.com.evil.test/login'],
    ['plain http', 'http://staging.example.com/login'],
    ['another port', 'https://staging.example.com:8443/login'],
  ])('refuses %s before any card or keychain read', async (_name, url) => {
    const chat = await projectChat();
    const saved = await save();
    const reads = vi.spyOn(secrets, 'get');
    fake.url = url;
    const refused = await chat.call('spark_browser_sign_in', { signIn: saved.id });
    expect(refused.outcome).toBe('not_signed_in');
    expect(refused.reason).toContain('Nothing was filled');
    expect(await cardCount()).toBe(0);
    expect(reads).not.toHaveBeenCalled();
    expect(fake.ops('sign_in')).toEqual([]);
    expect(signInAudits()).toEqual([
      expect.objectContaining({ decision: 'refused_origin', by: 'spark', signInOrigin: ORIGIN }),
    ]);
  });

  it('checks the page after it settled, names where it ended and keeps that tab open', async () => {
    const chat = await projectChat();
    const saved = await save();
    fake.url = 'https://auth.example.com/u/login?state=abc';
    const refused = await chat.call('spark_browser_sign_in', { signIn: saved.id });
    expect(fake.ops('page')[0]).toMatchObject({ settle: true });
    expect(refused.reason).toContain(
      `types only on ${ORIGIN}, and the tab is on https://auth.example.com`,
    );
    expect(refused.reason).toContain('after the page finished loading and redirecting');
    expect(fake.ops('keep')).toEqual([expect.objectContaining({ tab: 'tab1' })]);
    const { rows } = await t.db.query('SELECT refused_site FROM browser_sign_ins');
    expect(rows).toEqual([{ refused_site: 'https://auth.example.com' }]);
  });

  it('types on any of the sign-in’s sites, and asks again when the list changes', async () => {
    const chat = await projectChat('bypassPermissions');
    const saved = await createSignIn({ db: t.db, secrets }, projectId, {
      label: 'Staging admin',
      origin: ORIGIN,
      sites: ['https://auth.example.com'],
      ...PLANTED,
    });
    fake.url = 'https://auth.example.com/u/login';
    const { card } = await signInAllowing(chat);
    expect(card.title).toBe('Sign in to https://auth.example.com as Staging admin?');
    expect(fake.ops('sign_in')).toEqual([
      expect.objectContaining({ sites: [ORIGIN, 'https://auth.example.com'] }),
    ]);
    fake.url = 'https://auth.example.com/u/login';
    await chat.call('spark_browser_sign_in', { signIn: saved.id });
    expect(await cardCount()).toBe(1);

    await updateSignIn({ db: t.db, secrets }, projectId, saved.id, {
      label: 'Staging admin',
      origin: ORIGIN,
      sites: ['https://auth.example.com', 'https://example.okta.com'],
    });
    fake.url = 'https://example.okta.com/signin';
    await signInAllowing(chat);
    expect(await cardCount()).toBe(2);
    expect(fake.ops('sign_in').at(-1)).toMatchObject({
      sites: [ORIGIN, 'https://auth.example.com', 'https://example.okta.com'],
    });
  });

  it('passes on the plain reason when the browser finds no form', async () => {
    const chat = await projectChat();
    await save();
    fake.failure = new BrowserHostError(
      'no_form',
      'Spark could not find a sign-in form on this page. Nothing was filled.',
    );
    const { result } = await signInAllowing(chat);
    expect(result).toEqual({
      outcome: 'not_signed_in',
      reason: 'Spark could not find a sign-in form on this page. Nothing was filled.',
    });
    expect(fake.ops('keep')).toHaveLength(1);
    expect(signInAudits().at(-1)).toMatchObject({ decision: 'failed', result: 'no_form' });
  });

  it('says when the keychain entry is gone', async () => {
    const chat = await projectChat();
    const saved = await save();
    await secrets.delete(`signin:${saved.id}`);
    const { result } = await signInAllowing(chat);
    expect(result.outcome).toBe('not_signed_in');
    expect(result.reason).toContain('missing from the keychain');
    expect(fake.ops('sign_in')).toEqual([]);
  });

  it('does not know a label that is not saved', async () => {
    const chat = await projectChat();
    await save();
    const missing = await chat.call('spark_browser_sign_in', { signIn: 'Production' });
    expect(String(missing.error)).toContain('No saved sign-in has that label');
    expect(fake.requests).toEqual([]);
  });

  it('records who decided, the label and the site for every use', async () => {
    const chat = await projectChat();
    await save();
    const { card } = await signInAllowing(chat);
    expect(signInAudits()).toEqual([
      {
        tool: 'spark_browser_sign_in',
        runId: chat.runId,
        action: 'sign_in',
        page: `${ORIGIN}/login`,
        place: 'external',
        decision: 'user_allowed',
        signIn: 'Staging admin',
        signInOrigin: ORIGIN,
        signInSites: [ORIGIN],
        by: 'user',
        approvalId: card.id,
        result: 'form_submitted',
        steps: 1,
      },
    ]);
  });
});

describe('a planted sign-in never reaches the agent or the record', () => {
  it('stays out of tool results, events, the audit, logs and every table', async () => {
    const chat = await projectChat('bypassPermissions');
    await save();
    await chat.call('spark_browser_signins');
    await signInAllowing(chat);
    const read = await chat.call('spark_browser_read');
    await chat.call('spark_browser_read', { mode: 'text' });
    await chat.call('spark_browser_tabs');
    await chat.call('spark_browser_logs');
    await chat.call('spark_browser_logs', { kind: 'network' });
    fake.failure = new BrowserHostError('failed', `The page said ${ECHO}`);
    await chat.call('spark_browser_sign_in', { signIn: 'Staging admin' });
    fake.owner = 'agent';
    fake.failure = new BrowserHostError('failed', `ref_1 is covered by dialog '${ECHO}'.`);
    await chat.call('spark_browser_act', { action: 'click', ref: 'ref_1' });

    expect(fake.ops('act')).toHaveLength(1);
    expect(read.url).toBe(`${ORIGIN}/home?u=${SIGN_IN_HIDDEN}&p=${SIGN_IN_HIDDEN}`);
    expect(chat.results.join('\n')).toContain(SIGN_IN_HIDDEN);
    expect(plantedIn(chat.results.join('\n'))).toEqual([]);
    expect(chat.results.join('\n')).not.toContain(PLANTED.password.slice(0, 9));
    expect(plantedIn(JSON.stringify(recorded.events))).toEqual([]);
    expect(plantedIn(JSON.stringify(recorded.audited))).toEqual([]);
    expect(plantedIn(await everyStoredValue(t))).toEqual([]);
    const lines = logged.flatMap((spy) =>
      spy.mock.calls.map((printed: unknown[]) => JSON.stringify(printed)),
    );
    expect(plantedIn(lines.join('\n'))).toEqual([]);
  });

  it('filters logs after hiding the values, so a filter cannot probe for them', async () => {
    const chat = await projectChat();
    await save();
    const probed = await chat.call('spark_browser_logs', { filter: PLANTED.password.slice(0, 6) });
    expect(fake.ops('logs')[0]).toMatchObject({ limit: 200 });
    expect(fake.ops('logs')[0]).not.toHaveProperty('filter');
    expect(probed.entries).toBe(0);
    const plain = await chat.call('spark_browser_logs', { filter: 'ready' });
    expect(plain.entries).toBe(1);
    const network = await chat.call('spark_browser_logs', { kind: 'network', filter: 'sk_test' });
    expect(network.entries).toBe(0);
    await chat.call('spark_browser_logs', { kind: 'network' });
    const shown = chat.results.at(-1)!;
    expect(shown).toContain(`u=${SIGN_IN_HIDDEN}&k=[redacted:secret_value]&offset=5`);
    expect(shown).not.toContain(FILE_SECRET);
  });
});

describe('handing the tab to the user to sign in', () => {
  const handOvers = () =>
    fake.ops('hand_over') as Extract<BrowserHostRequest, { op: 'hand_over' }>[];

  it('holds the tab with a card until the user selects Done, then gives it back', async () => {
    const chat = await projectChat('bypassPermissions');
    const calling = chat.call('spark_browser_sign_in', { handOver: true });
    const card = await pendingCard(t);
    expect(card.title).toBe(`Claude is waiting for you to sign in to ${ORIGIN}`);
    expect(card.payload.sparkAction).toEqual({
      action: 'browser_handoff',
      agent: 'Claude',
      site: ORIGIN,
      tabId: 'tab1',
    });
    expect(card.options.map((option) => option.name)).toEqual(['Done', 'Cancel']);
    await eventually(async () => handOvers().length === 1);
    expect(handOvers()[0]!.handoff).toEqual({ agent: 'Claude', site: ORIGIN, approvalId: card.id });
    await decideApproval(t.db, t.workspaceId, card.id, {
      optionId: SPARK_ACTION_OPTION.confirm,
      scope: 'once',
    });
    expect(await calling).toMatchObject({ outcome: 'handed_back', tab: 'tab1' });
    expect(handOvers().at(-1)!.handoff).toBeNull();
    expect(fake.ops('sign_in')).toEqual([]);
    const audits = (recorded.audited as { params: Record<string, unknown> }[])
      .map((entry) => entry.params)
      .filter((params) => params.action === 'hand_over');
    expect(audits.map((params) => params.result)).toEqual(['waiting', 'handed_back']);
  });

  it('lets the user cancel, and frees the tab', async () => {
    const chat = await projectChat();
    const calling = chat.call('spark_browser_sign_in', { handOver: true });
    const card = await pendingCard(t);
    await decideApproval(t.db, t.workspaceId, card.id, {
      optionId: SPARK_ACTION_OPTION.decline,
      scope: 'once',
    });
    expect(await calling).toMatchObject({ outcome: 'cancelled' });
    expect(handOvers().at(-1)!.handoff).toBeNull();
  });

  it('frees the tab when the user stops the turn, and is never answered from a paired device', async () => {
    const chat = await projectChat();
    const calling = chat.call('spark_browser_sign_in', { handOver: true });
    const card = await pendingCard(t);
    expect(macOnlyCard(card.payload)).toBe(true);
    await eventually(async () => handOvers().length === 1);
    recorded.stop();
    expect(await calling).toMatchObject({ outcome: 'cancelled' });
    expect(handOvers().at(-1)!.handoff).toBeNull();
  });
});
