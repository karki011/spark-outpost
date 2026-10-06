import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SPARK_ACTION_OPTION,
  sparkResultFinished,
  type Approval,
  type InvolvementLevel,
  type RunEvent,
} from '@spark-outpost/contracts';
import { decideApproval, getApproval, type UserDecision } from '../src/persistence/approvals.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import type { SparkActionHooks, SparkScope, SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { EVERYTHING_AVAILABLE } from '../src/spark-mcp/availability.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { startSparkMcpHost, type SparkGrant, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { startSparkActionFollowThrough } from '../src/spark-mcp/actions/follow-through.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { eventually, type TestDb } from './support.ts';

export interface SparkToolsHarness {
  host: SparkMcpHost;
  call(name: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<CallResult>;
  close(): Promise<void>;
}

export interface CallResult {
  text: string;
  isError: boolean;
  json<T = Record<string, unknown>>(): T;
}

export function toolDeps(t: TestDb, overrides: Partial<SparkToolDeps> = {}): SparkToolDeps {
  return {
    db: t.db,
    secrets: memorySecretStore(),
    fetch,
    github: {
      runCommand: async () => ({ code: 1, stdout: '', stderr: 'gh missing' }),
      locateGh: async () => null,
    },
    serverSpendCapUsd: null,
    timeZone: 'UTC',
    ...overrides,
  };
}

export async function connectClient(grant: SparkGrant): Promise<Client> {
  const client = new Client({ name: 'spark-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(grant.url), {
      requestInit: { headers: { Authorization: `Bearer ${grant.token}` } },
    }) as Transport,
  );
  return client;
}

export async function startSparkTools(
  t: TestDb,
  scope: Partial<SparkScope> = {},
  overrides: Partial<SparkToolDeps> = {},
): Promise<SparkToolsHarness> {
  const deps = toolDeps(t, overrides);
  const host = await startSparkMcpHost(deps, async () => ({
    ...EVERYTHING_AVAILABLE,
    browser: deps.browser !== undefined,
  }));
  const followThrough = await startSparkActionFollowThrough(deps, 25);
  const grant = await host.grant({
    workspaceId: t.workspaceId,
    conversationId: null,
    runId: null,
    ...scope,
  });
  const client = await connectClient(grant);
  return {
    host,
    async call(name, args = {}, signal) {
      const result = (await client.callTool(
        { name, arguments: args },
        undefined,
        signal ? { signal } : {},
      )) as CallToolResult;
      const first = result.content[0];
      const text = first?.type === 'text' ? first.text : '';
      return {
        text,
        isError: result.isError === true,
        json: <T>() => JSON.parse(text) as T,
      };
    },
    async close() {
      await client.close();
      await followThrough.stop();
      await host.close();
    },
  };
}

export interface RecordedHooks {
  hooks: SparkActionHooks;
  events: RunEvent[];
  audited: unknown[];
  stop(): void;
}

export function recordedHooks(): RecordedHooks {
  const events: RunEvent[] = [];
  const audited: unknown[] = [];
  const controller = new AbortController();
  return {
    events,
    audited,
    stop: () => controller.abort(),
    hooks: {
      append: async (event) => events.push(event),
      waiters: new ApprovalWaiters(),
      signal: controller.signal,
      timeoutMs: 15_000,
      pollMs: 25,
      audit: { message: (_direction, message) => audited.push(message), stderr: () => undefined },
    },
  };
}

export async function pendingCard(t: TestDb): Promise<Approval> {
  const approval = await eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE kind = 'spark_action' AND status = 'pending'`,
    );
    return rows[0] ? getApproval(t.db, rows[0].id) : null;
  }, 10_000);
  return approval!;
}

export async function answerCard(
  t: TestDb,
  optionId: string,
  extra: Omit<UserDecision, 'optionId' | 'scope'> = {},
): Promise<Approval> {
  const card = await pendingCard(t);
  await decideApproval(t.db, t.workspaceId, card.id, { optionId, scope: 'once', ...extra });
  return card;
}

export async function cardResult(t: TestDb, id: string): Promise<Approval> {
  const settled = await eventually(async () => {
    const approval = await getApproval(t.db, id);
    if (!approval) return null;
    if (approval.status === 'pending') return null;
    if (approval.status !== 'allowed') return approval;
    return sparkResultFinished(approval.payload.sparkResult) ? approval : null;
  }, 15_000);
  return settled!;
}

export async function confirmCard(
  t: TestDb,
  extra: Omit<UserDecision, 'optionId' | 'scope'> = {},
): Promise<Approval> {
  const card = await answerCard(t, SPARK_ACTION_OPTION.confirm, extra);
  return cardResult(t, card.id);
}

export async function fullAutoChat(t: TestDb, conversationId: string): Promise<void> {
  await chatAtLevel(t, conversationId, 'full-auto');
}

export async function chatAtLevel(
  t: TestDb,
  conversationId: string,
  level: InvolvementLevel,
): Promise<void> {
  await t.db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, 'claude', 'cli', 'test', '[]', 'opus', 'do', 'medium', now())
     ON CONFLICT DO NOTHING`,
    [t.workspaceId],
  );
  await updateChatSettings(t.db, conversationId, { provider: 'claude', level });
}
