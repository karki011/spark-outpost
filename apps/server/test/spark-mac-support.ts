import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SPARK_ACTION_OPTION,
  refusedBundleId,
  type Approval,
  type MacApp,
  type MacHostRequest,
  type MacIdentity,
  type MacTarget,
} from '@spark-outpost/contracts';
import { MacHostError, type MacHost } from '../src/mac-control/host-client.ts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { startSparkMcpHost, type SparkGrant, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import type { SparkScope } from '../src/spark-mcp/deps.ts';
import {
  connectClient,
  pendingCard,
  recordedHooks,
  toolDeps,
  type RecordedHooks,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const button = (title: string): MacIdentity => ({
  role: 'AXButton',
  subrole: null,
  title,
  description: null,
  identifier: null,
});

export const MAC_TARGETS: Record<string, MacIdentity> = {
  ax_3: button('7'),
  ax_4: button('Send'),
  ax_5: button('Buy Now'),
};

function app(name: string, bundleId: string, pid: number): MacApp {
  return {
    pid,
    name,
    bundleId,
    frontmost: false,
    windows: [{ index: 0, title: name }],
    refused: refusedBundleId(bundleId),
  };
}

const CONVERSATION_MODES: Record<string, string> = { claude: 'default', codex: 'read-only' };

export const CALCULATOR = app('Calculator', 'com.apple.calculator', 700);
export const NOTES = app('Notes', 'com.apple.Notes', 701);
export const SETTINGS = app('System Settings', 'com.apple.systempreferences', 702);

export class FakeMacHost implements MacHost {
  readonly requests: MacHostRequest[] = [];
  apps: MacApp[] = [CALCULATOR, NOTES, SETTINGS];
  focused: MacIdentity = button('OK');
  targetPid = 700;
  targetError: MacHostError | null = null;
  readError: MacHostError | null = null;
  targetState: MacTarget['state'] = 'alive';
  readText = '- window "Calculator" [ax_1]\n  - static text [ax_2] value="42"';

  request(request: MacHostRequest): Promise<never> {
    this.requests.push(request);
    try {
      return Promise.resolve(this.answer(request) as never);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private target(ref: string, identity: MacIdentity): MacTarget {
    return {
      ref,
      state: this.targetState,
      pid: this.targetPid,
      window: { index: 0, title: 'Calculator' },
      identity,
      ancestors: [],
      actions: ['AXPress'],
      secure: false,
    };
  }

  private answer(request: MacHostRequest): unknown {
    if (request.op === 'apps') return { apps: this.apps };
    if (request.op === 'resolve') {
      const found = this.apps.find(
        (candidate) => candidate.name === request.app || candidate.bundleId === request.app,
      );
      if (!found) throw new MacHostError('no_app', `${request.app} is not running.`);
      return { app: found };
    }
    if (request.op === 'read') {
      if (this.readError) throw this.readError;
      const found = this.apps.find((candidate) => candidate.pid === request.pid)!;
      return {
        app: found,
        window: { index: 0, title: found.name },
        scope: 'window',
        rootRef: 'ax_1',
        mode: request.mode,
        text: this.readText,
        total: 2,
        offset: 0,
        nextOffset: null,
        leftOut: 0,
        masked: 0,
        truncated: false,
      };
    }
    if (request.op === 'target') {
      if (this.targetError) throw this.targetError;
      const found = this.apps.find((candidate) => candidate.pid === request.pid)!;
      if (request.menu)
        return { app: found, target: this.target('ax_9', button(request.menu.at(-1)!)) };
      if (request.focused) return { app: found, target: this.target('ax_8', this.focused) };
      return { app: found, target: this.target(request.ref!, MAC_TARGETS[request.ref!]!) };
    }
    if (request.op === 'act') return { did: request.did };
    if (request.op === 'open') return { app: CALCULATOR };
    return { ended: true };
  }

  ops(): string[] {
    return this.requests.map((request) => request.op);
  }
}

export interface MacCall {
  result: CallToolResult;
  texts: string[];
  facts: Record<string, unknown>;
}

export interface MacSessionOptions {
  mode?: string;
  provider?: string;
  macControl?: boolean;
  scope?: Partial<SparkScope>;
  noCards?: boolean;
}

export class MacHarness {
  readonly fake = new FakeMacHost();
  readonly recorded: RecordedHooks = recordedHooks();
  chat = { conversationId: '', runId: '' };
  private host: SparkMcpHost | null = null;
  private client: Client | null = null;
  private grant: SparkGrant | null = null;

  private constructor(readonly t: TestDb) {}

  static async create(): Promise<MacHarness> {
    return new MacHarness(await createTestDb());
  }

  async close(): Promise<void> {
    this.recorded.stop();
    await this.client?.close();
    await this.host?.close();
    await this.t.cleanup();
  }

  async newChat(mode = 'default', provider = 'claude'): Promise<void> {
    this.chat = await startChat(this.t, 'Work out 7 times 6');
    await this.t.db.query(
      `UPDATE runs SET provider = $2, agent_mode = $3, used_mode = $4 WHERE id = $1`,
      [this.chat.runId, provider, mode, CONVERSATION_MODES[provider]],
    );
  }

  async start(options: MacSessionOptions = {}): Promise<void> {
    const { t, recorded } = this;
    await t.db.query('INSERT INTO profiles (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      t.workspaceId,
    ]);
    await t.db.query('UPDATE profiles SET mac_control = $2 WHERE workspace_id = $1', [
      t.workspaceId,
      options.macControl ?? true,
    ]);
    if (!this.chat.runId) await this.newChat(options.mode, options.provider);
    await this.client?.close();
    await this.host?.close();
    this.host = await startSparkMcpHost(toolDeps(t, { mac: this.fake }));
    const { conversationId, runId } = this.chat;
    const grant = (this.grant = await this.host.grant({
      workspaceId: t.workspaceId,
      conversationId,
      runId,
      ...(options.noCards ? {} : { actions: recorded.hooks }),
      observations: createRunObservations({ db: t.db, runId, audit: recorded.hooks.audit }),
      ...options.scope,
    }));
    this.client = await connectClient(grant);
  }

  async revoke(): Promise<void> {
    this.grant?.revoke();
  }

  async toolNames(): Promise<string[]> {
    const listed = await this.client!.listTools();
    return listed.tools.map((tool) => tool.name).filter((name) => name.startsWith('spark_mac'));
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<MacCall> {
    const result = (await this.client!.callTool({ name, arguments: args })) as CallToolResult;
    const texts = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
    const facts = (result.isError ? {} : JSON.parse(texts[0] ?? '{}')) as Record<string, unknown>;
    return { result, texts, facts };
  }

  audited(): Record<string, unknown>[] {
    return (this.recorded.audited as { method: string; params: Record<string, unknown> }[])
      .filter((entry) => entry.method === 'spark/mac')
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

  async cards(): Promise<string[]> {
    const { rows } = await this.t.db.query<{ action: string }>(
      `SELECT a.payload->'sparkAction'->>'action' AS action FROM approvals a
       JOIN runs r ON r.id = a.run_id WHERE r.conversation_id = $1 ORDER BY a.created_at`,
      [this.chat.conversationId],
    );
    return rows.map((row) => row.action);
  }

  async allowFirstUse(app = 'Calculator'): Promise<void> {
    const reading = this.call('spark_mac_read', { app });
    await this.answer('confirm');
    await reading;
  }
}
