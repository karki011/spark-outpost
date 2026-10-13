import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SPARK_ACTION_OPTION,
  browserPlaceOf,
  type Approval,
  type BrowserActTarget,
  type BrowserHostRequest,
} from '@spark-outpost/contracts';
import type { BrowserHost } from '../src/browser/host-client.ts';
import { BrowserHostError } from '../src/browser/host-client.ts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { listRailFlags } from '../src/persistence/rail-flags.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { doRun } from './approval-support.ts';
import { repoWithRemote } from './ship-support.ts';
import {
  connectClient,
  pendingCard,
  recordedHooks,
  toolDeps,
  type RecordedHooks,
} from './spark-mcp-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

export const SITE = 'https://docs.example.com';
export const PAGE = `${SITE}/guide/start?utm=1`;
export const TOKEN = 'tok_live_9f8e7d6c5b4a3210';
const TARGETS: Record<string, BrowserActTarget> = {
  ref_1: { role: 'button', name: 'Search', sensitive: false },
  ref_2: { role: 'searchbox', name: 'Search the docs', sensitive: false },
  ref_3: { role: 'textbox', name: '', sensitive: true },
};

export class FakeBrowserHost implements BrowserHost {
  readonly requests: BrowserHostRequest[] = [];
  url = 'about:blank';
  owner: 'agent' | 'user' = 'agent';
  landsOn: string | null = null;
  refuses: string | null = null;

  request(request: BrowserHostRequest): Promise<never> {
    this.requests.push(request);
    if (request.op === 'open' && this.refuses) {
      return Promise.reject(new BrowserHostError('not_allowed', this.refuses));
    }
    return Promise.resolve(this.answer(request) as never);
  }

  private facts() {
    return {
      tabId: 'tab1',
      url: this.url,
      title: 'Docs',
      place: browserPlaceOf(this.url),
      owner: this.owner,
    };
  }

  private answer(request: BrowserHostRequest): unknown {
    if (request.op === 'open') {
      this.url = this.landsOn ?? request.url;
      return { ...this.facts(), status: 200, reused: false };
    }
    if (request.op === 'page') {
      return { ...this.facts(), target: request.ref ? TARGETS[request.ref] : null };
    }
    if (request.op === 'act') {
      const from = this.url;
      if (request.action === 'click') this.url = `${SITE}/results?q=secret`;
      const target = request.ref ? TARGETS[request.ref]! : null;
      return { ...this.facts(), action: request.action, target, from, did: 'Did it' };
    }
    if (request.op === 'read') {
      return {
        ...this.facts(),
        mode: request.mode,
        text: '- searchbox "Search the docs" [ref_2]',
        total: 1,
        offset: 0,
        nextOffset: null,
        masked: 0,
      };
    }
    return { closed: 0 };
  }

  ops(): string[] {
    return this.requests.map((request) => request.op);
  }
}

export interface BrowseSession {
  provider?: string;
  mode?: string;
  message?: string;
  root?: string;
}

export interface BrowseCall {
  result: CallToolResult;
  texts: string[];
  facts: Record<string, unknown>;
}

export class BrowseHarness {
  readonly fake = new FakeBrowserHost();
  readonly recorded: RecordedHooks = recordedHooks();
  chat = { conversationId: '', runId: '' };
  private host: SparkMcpHost | null = null;
  private client: Client | null = null;
  private base: string | null = null;

  private constructor(readonly t: TestDb) {}

  static async create(): Promise<BrowseHarness> {
    return new BrowseHarness(await createTestDb());
  }

  async close(): Promise<void> {
    this.recorded.stop();
    await this.client?.close();
    await this.host?.close();
    if (this.base) await rm(this.base, { recursive: true, force: true });
    await this.t.cleanup();
  }

  async projectWithSecret(): Promise<string> {
    this.base = await realpath(await mkdtemp(join(tmpdir(), 'spark-browse-')));
    const { root } = await repoWithRemote(this.base, 'widgets');
    await writeFile(join(root, '.gitignore'), '.env\n');
    await writeFile(join(root, '.env'), `API_TOKEN=${TOKEN}\n`);
    return root;
  }

  async start(session: BrowseSession = {}): Promise<void> {
    const { t, recorded } = this;
    const message = session.message ?? 'Fix the layout bug';
    this.chat = session.root ? await doRun(t, session.root, message) : await startChat(t, message);
    const { conversationId, runId } = this.chat;
    await t.db.query(`UPDATE runs SET provider = $2, used_mode = $3 WHERE id = $1`, [
      runId,
      session.provider ?? 'claude',
      session.mode ?? 'default',
    ]);
    this.host = await startSparkMcpHost(toolDeps(t, { browser: this.fake }));
    const grant = await this.host.grant({
      workspaceId: t.workspaceId,
      conversationId,
      runId,
      actions: recorded.hooks,
      observations: createRunObservations({ db: t.db, runId, audit: recorded.hooks.audit }),
    });
    this.client = await connectClient(grant);
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<BrowseCall> {
    const result = (await this.client!.callTool({ name, arguments: args })) as CallToolResult;
    const texts = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
    const facts = (result.isError ? {} : JSON.parse(texts[0] ?? '{}')) as Record<string, unknown>;
    return { result, texts, facts };
  }

  audited(method: string): Record<string, unknown>[] {
    return (this.recorded.audited as { method: string; params: Record<string, unknown> }[])
      .filter((entry) => entry.method === method)
      .map((entry) => entry.params);
  }

  pending(): Promise<Approval> {
    return pendingCard(this.t);
  }

  async answer(option: 'confirm' | 'decline'): Promise<Approval> {
    const card = await this.pending();
    await decideApproval(this.t.db, this.t.workspaceId, card.id, {
      optionId: SPARK_ACTION_OPTION[option],
      scope: 'once',
    });
    this.recorded.hooks.waiters.notify(card.id);
    return card;
  }

  async cards(): Promise<number> {
    const { rows } = await this.t.db.query(`SELECT 1 FROM approvals WHERE run_id = $1`, [
      this.chat.runId,
    ]);
    return rows.length;
  }

  async flagTitles(): Promise<string[]> {
    return (await listRailFlags(this.t.db, this.chat.conversationId)).map((flag) => flag.title);
  }

  async flags(): Promise<string[]> {
    const found = await eventually(async () => {
      const titles = await this.flagTitles();
      return titles.length > 0 ? titles : null;
    });
    return found!;
  }
}
