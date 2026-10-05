import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPARK_ACTION_OPTION, type BrowserHostRequest } from '@spark-outpost/contracts';
import { BrowserHostError, type BrowserHost } from '../src/browser/host-client.ts';
import { createSignIn } from '../src/browser/sign-ins.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { SIGN_IN_HIDDEN } from '../src/spark-mcp/tools/browser/scrub.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import { PLANTED, everyStoredValue, plantedIn } from './sign-in-support.ts';
import {
  connectClient,
  fullAutoChat,
  pendingCard,
  recordedHooks,
  toolDeps,
  type RecordedHooks,
} from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const ORIGIN = 'https://staging.example.com';
const ECHO = `${PLANTED.username} / ${PLANTED.password}`;

class FakeBrowserHost implements BrowserHost {
  readonly requests: BrowserHostRequest[] = [];
  url = `${ORIGIN}/login`;
  failure: BrowserHostError | null = null;

  request(request: BrowserHostRequest): Promise<never> {
    this.requests.push(request);
    if (this.failure && request.op === 'sign_in') return Promise.reject(this.failure);
    return Promise.resolve(this.answer(request) as never);
  }

  ops(op: BrowserHostRequest['op']) {
    return this.requests.filter((request) => request.op === op);
  }

  private answer(request: BrowserHostRequest): unknown {
    const facts = {
      tabId: 'tab1',
      url: this.url,
      title: `Welcome ${PLANTED.username}`,
      place: 'external',
      owner: 'user',
    };
    if (request.op === 'sign_in') {
      this.url = `${ORIGIN}/home?u=${encodeURIComponent(PLANTED.username)}&p=${encodeURIComponent(PLANTED.password)}`;
      return { ...facts, url: this.url, steps: 1 };
    }
    if (request.op === 'tabs') {
      return {
        tabs: [
          {
            id: 'tab1',
            title: facts.title,
            url: this.url,
            owner: 'user',
            active: true,
            place: 'local',
          },
        ],
      };
    }
    if (request.op === 'read') {
      return {
        ...facts,
        place: 'local',
        mode: request.mode,
        text: `- textbox "Email" [ref_1] value="${PLANTED.username}"\n- paragraph "debug ${ECHO}"\n- paragraph "${PLANTED.password.slice(0, 9)}…"`,
        total: 3,
        offset: 0,
        nextOffset: null,
        masked: 1,
      };
    }
    if (request.op === 'logs') {
      return {
        ...facts,
        place: 'local',
        kind: request.kind,
        entries: [
          {
            at: '2026-10-05T10:00:00.000Z',
            level: 'log',
            text: `signing in ${ECHO}`,
            source: null,
            status: null,
            method: null,
          },
          {
            at: '2026-10-05T10:00:01.000Z',
            level: 'log',
            text: 'ready',
            source: null,
            status: null,
            method: null,
          },
        ],
        dropped: 0,
      };
    }
    return facts;
  }
}

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
    host!.grant({
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
    expect(listed.signIns).toEqual([{ id: saved.id, label: 'Staging admin', site: ORIGIN }]);
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
    });
    expect(result).toMatchObject({
      outcome: 'form_submitted',
      signIn: 'Staging admin',
      tab: 'tab1',
      page: `${ORIGIN}/home`,
      steps: 1,
    });
    expect(fake.ops('sign_in')).toEqual([
      expect.objectContaining({ tab: 'tab1', origin: ORIGIN, ...PLANTED }),
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

    expect(read.url).toBe(`${ORIGIN}/home?u=${SIGN_IN_HIDDEN}&p=${SIGN_IN_HIDDEN}`);
    expect(chat.results.join('\n')).toContain(SIGN_IN_HIDDEN);
    expect(plantedIn(chat.results.join('\n'))).toEqual([]);
    expect(chat.results.join('\n')).not.toContain(PLANTED.password.slice(0, 9));
    expect(plantedIn(JSON.stringify(recorded.events))).toEqual([]);
    expect(plantedIn(JSON.stringify(recorded.audited))).toEqual([]);
    expect(plantedIn(await everyStoredValue(t))).toEqual([]);
    const lines = logged.flatMap((spy) => spy.mock.calls.map((printed: unknown[]) => JSON.stringify(printed)));
    expect(plantedIn(lines.join('\n'))).toEqual([]);
  });

  it('filters logs after hiding the values, so a filter cannot probe for them', async () => {
    const chat = await projectChat();
    await save();
    const probed = await chat.call('spark_browser_logs', { filter: PLANTED.password.slice(0, 6) });
    expect(fake.ops('logs')[0]).toMatchObject({ filter: undefined, limit: 200 });
    expect(probed.entries).toBe(0);
    const plain = await chat.call('spark_browser_logs', { filter: 'ready' });
    expect(plain.entries).toBe(1);
  });
});
