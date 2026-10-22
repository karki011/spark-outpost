import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { startSparkActionFollowThrough } from '../src/spark-mcp/actions/follow-through.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { connectClient, recordedHooks, toolDeps, type RecordedHooks } from './spark-mcp-support.ts';
import { startChat, type TestDb } from './support.ts';

export interface ArtifactCall {
  result: CallToolResult;
  text: string;
  facts: Record<string, unknown>;
}

export class ArtifactHarness {
  readonly recorded: RecordedHooks = recordedHooks();
  chat = { conversationId: '', runId: '' };
  private host: SparkMcpHost | null = null;
  private client: Client | null = null;
  private stopFollowThrough: (() => Promise<void>) | null = null;

  private constructor(
    readonly t: TestDb,
    readonly base: string,
  ) {}

  static async create(t: TestDb): Promise<ArtifactHarness> {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'spark-artifacts-')));
    return new ArtifactHarness(t, base);
  }

  async start(mode: string): Promise<void> {
    this.chat = await startChat(this.t, 'Make me a dashboard');
    await this.t.db.query(
      `UPDATE runs SET provider = 'claude', agent_mode = $2, used_mode = $2 WHERE id = $1`,
      [this.chat.runId, mode],
    );
    const deps = toolDeps(this.t, { chatFolders: this.base });
    this.host = await startSparkMcpHost(deps);
    const followThrough = await startSparkActionFollowThrough(deps, 25);
    this.stopFollowThrough = () => followThrough.stop();
    const grant = await this.host.grant({
      workspaceId: this.t.workspaceId,
      conversationId: this.chat.conversationId,
      runId: this.chat.runId,
      actions: this.recorded.hooks,
      observations: createRunObservations({
        db: this.t.db,
        runId: this.chat.runId,
        audit: this.recorded.hooks.audit,
      }),
    });
    this.client = await connectClient(grant);
  }

  async call(args: Record<string, unknown>): Promise<ArtifactCall> {
    const result = (await this.client!.callTool({
      name: 'spark_artifact',
      arguments: args,
    })) as CallToolResult;
    const first = result.content[0];
    const text = first?.type === 'text' ? first.text : '';
    const facts = result.isError ? {} : (JSON.parse(text) as Record<string, unknown>);
    return { result, text, facts };
  }

  async close(): Promise<void> {
    this.recorded.stop();
    await this.client?.close();
    await this.stopFollowThrough?.();
    await this.host?.close();
    await rm(this.base, { recursive: true, force: true });
  }
}
