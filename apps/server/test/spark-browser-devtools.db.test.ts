import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type BrowserHostRequest } from '@spark-outpost/contracts';
import type { BrowserHost } from '../src/browser/host-client.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { linkedConversation, sendDo } from './approval-support.ts';
import {
  connectClient,
  pendingCard,
  recordedHooks,
  toolDeps,
  type RecordedHooks,
} from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SECRET = 'sk_live_4f3e2d1c0b9a8877';
const SITE = 'https://shop.example.com';
const AUTH_VALUE = 'auth-value-from-the-users-sign-in';
const COOKIE_VALUE = 'cookie-value-from-the-users-sign-in';

class FakeHost implements BrowserHost {
  readonly requests: BrowserHostRequest[] = [];
  url = `${SITE}/cart`;
  owner: 'agent' | 'user' = 'agent';

  request(request: BrowserHostRequest): Promise<never> {
    this.requests.push(request);
    return Promise.resolve(this.answer(request) as never);
  }

  ops(op: BrowserHostRequest['op']) {
    return this.requests.filter((request) => request.op === op);
  }

  private answer(request: BrowserHostRequest): unknown {
    const facts = {
      tabId: 'tab1',
      url: this.url,
      title: 'Cart',
      place: this.url.startsWith('http://localhost') ? 'local' : 'external',
      owner: this.owner,
    };
    if (request.op === 'evaluate') {
      return {
        ...facts,
        type: 'object',
        value: JSON.stringify({ items: 2, key: SECRET }),
        exception: null,
        truncated: false,
        masked: 1,
      };
    }
    if (request.op === 'storage') {
      return {
        ...facts,
        valuesShown: request.values,
        local: [
          { key: 'cart', bytes: 30, ...(request.values ? { value: `t=${SECRET}` } : {}) },
          { key: 'sb-ref-auth-token', bytes: 40, value: AUTH_VALUE },
          { key: 'theme', bytes: 9, value: 'dark' },
        ],
        session: [],
        cookies: [
          {
            name: 'sid',
            domain: 'shop.example.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: null,
            expires: null,
            bytes: 30,
            value: COOKIE_VALUE,
          },
        ],
      };
    }
    if (request.op === 'performance') {
      return {
        ...facts,
        navigation: { ttfbMs: 80 },
        resources: { count: 0, byType: {}, slowest: [] },
        vitals: {
          lcpMs: 900,
          cls: 0,
          inpMs: null,
          longTasks: 0,
          longTaskMs: 0,
          longestTaskMs: null,
        },
      };
    }
    return facts;
  }
}

let t: TestDb;
let base: string;
let host: SparkMcpHost | null = null;
let client: Client | null = null;
let recorded: RecordedHooks;
let fake: FakeHost;

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  fake = new FakeHost();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-devtools-')));
  writeFileSync(path.join(base, '.env'), `STRIPE_SECRET_KEY=${SECRET}\n`);
  host = await startSparkMcpHost(toolDeps(t, { browser: fake }));
});

afterEach(async () => {
  recorded.stop();
  await client?.close();
  await host?.close();
  client = null;
  host = null;
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

async function chat(mode: string) {
  const { conversationId } = await linkedConversation(t, base);
  const runId = await sendDo(t, conversationId, 'Check why the cart shows two items');
  await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
    runId,
    mode,
  ]);
  client = await connectClient(
    await host!.grant({
      workspaceId: t.workspaceId,
      conversationId,
      runId,
      actions: recorded.hooks,
    }),
  );
}

async function call(args: Record<string, unknown>) {
  const result = (await client!.callTool({
    name: 'spark_browser_devtools',
    arguments: args,
  })) as CallToolResult;
  const texts = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  return { facts: JSON.parse(texts[0] ?? '{}') as Record<string, unknown>, body: texts[1] ?? '' };
}

function audits() {
  return (recorded.audited as { method: string; params: Record<string, unknown> }[])
    .filter((entry) => entry.method === 'spark/browser')
    .map((entry) => entry.params);
}

describe('spark_browser_devtools', () => {
  it('runs an expression on a website in Auto, scrubs the result and audits the code, never the result', async () => {
    await chat('auto');
    const expression = `localStorage.getItem('cart') // ${SECRET}`;
    const { facts, body } = await call({ action: 'eval', expression });
    expect(fake.ops('evaluate')).toEqual([
      expect.objectContaining({ expression, origin: SITE, tab: 'tab1' }),
    ]);
    expect(facts).toMatchObject({ type: 'object', maskedValues: 1 });
    expect(body).toContain('<page_evidence');
    expect(body).toContain('"items":2');
    expect(body).not.toContain(SECRET);
    const [entry] = audits().filter((params) => params.action === 'eval');
    expect(entry).toMatchObject({ decision: 'mode', chars: expression.length });
    expect(entry!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(JSON.stringify(entry)).not.toContain('"items"');
  });

  it('asks before running on a website in Manual, and runs nothing when declined', async () => {
    await chat('default');
    const calling = call({ action: 'eval', expression: 'document.title' });
    const card = await pendingCard(t);
    expect(card.payload.sparkAction).toMatchObject({ action: 'act_page', origin: SITE });
    await decideApproval(t.db, t.workspaceId, card.id, {
      optionId: SPARK_ACTION_OPTION.decline,
      scope: 'once',
    });
    expect((await calling).facts).toMatchObject({ outcome: 'declined', site: SITE });
    expect(fake.ops('evaluate')).toEqual([]);
  });

  it('always asks on a tab the user owns, even in Bypass permissions and on a local page', async () => {
    await chat('bypassPermissions');
    fake.owner = 'user';
    fake.url = 'http://localhost:5173/';
    const calling = call({ action: 'eval', expression: 'document.title' }).catch(() => null);
    const card = await pendingCard(t);
    expect(card.payload.sparkAction).toMatchObject({ action: 'act_page', userTab: true });
    expect(fake.ops('evaluate')).toEqual([]);
    recorded.stop();
    await calling;
    expect(fake.ops('evaluate')).toEqual([]);
  });

  it('reads storage and performance under the read policy, with values scrubbed', async () => {
    await chat('auto');
    const stored = await call({ action: 'storage', values: true });
    expect(stored.facts).toMatchObject({ action: 'storage', place: 'external' });
    expect(stored.body).toContain('"key": "cart"');
    expect(stored.body).not.toContain(SECRET);
    expect(fake.ops('storage')).toEqual([expect.objectContaining({ values: true })]);
    expect(stored.body).not.toContain(AUTH_VALUE);
    expect(stored.body).not.toContain(COOKIE_VALUE);
    expect(stored.body).toContain('"masked": true');
    expect(stored.body).toContain('"value": "dark"');
    const timing = await call({ action: 'performance' });
    expect(timing.body).toContain('"lcpMs": 900');
    expect(audits().map((params) => params.action)).toEqual(
      expect.arrayContaining(['read', 'read']),
    );
  });

  it('shows no storage value from a tab the user owns, whatever the host returns', async () => {
    await chat('auto');
    fake.owner = 'user';
    const stored = await call({ action: 'storage', values: true });
    expect(stored.body).toContain('"key": "theme"');
    expect(stored.body).not.toContain('"value"');
    expect(stored.body).not.toContain(COOKIE_VALUE);
  });

  it('needs an expression for eval and a ref or selector for inspect', async () => {
    await chat('auto');
    const result = (await client!.callTool({
      name: 'spark_browser_devtools',
      arguments: { action: 'inspect' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(fake.ops('inspect')).toEqual([]);
  });
});
