import { describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { agentDefinitions } from './agents.ts';
import {
  openSparkTools,
  sparkToolsHint,
  sparkAcpServer,
  sparkReserved,
  withCodexSparkServer,
  withSparkServer,
} from './spark-tools.ts';

const scope = { workspaceId: 'w', conversationId: 'c', runId: 'r' };
const grant = { url: 'http://127.0.0.1:5555/mcp', token: 'tok-123', revoke: () => undefined };
const access = { grant: async () => grant };
const withHttp = {
  agentCapabilities: { mcpCapabilities: { http: true } },
} as acp.InitializeResponse;
const withoutHttp = { agentCapabilities: {} } as acp.InitializeResponse;
const HOUR_MS = 3_600_000;
const FIVE_MINUTES_MS = 300_000;

interface ClaudeHttpServer {
  timeout?: number;
}

function pinnedClaudeLimits({ timeout }: ClaudeHttpServer) {
  const own = timeout !== undefined && timeout >= 1_000 ? timeout : undefined;
  const wallMs = own ?? 100_000_000;
  return {
    firstByteMs: Math.max(own === undefined ? 60_000 : Math.max(own, 60_000), 30_000),
    silentMs: Math.min(Math.max(300_000, own ?? 0), wallMs),
    wallMs,
  };
}

function claudeServers(request: acp.NewSessionRequest): Record<string, ClaudeHttpServer> {
  const meta = request._meta as { claudeCode: { options: { mcpServers?: object } } } | null;
  return (meta?.claudeCode.options.mcpServers ?? {}) as Record<string, ClaudeHttpServer>;
}

describe('Spark tools for agent sessions', () => {
  it('opens only with a host and a scope, and steps aside from a Codex server called spark', async () => {
    expect(await openSparkTools(undefined, scope, sparkToolsHint(undefined, scope, []))).toBeNull();
    expect(await openSparkTools(access, undefined, sparkToolsHint(access, undefined, []))).toBeNull();
    expect((await openSparkTools(access, scope, sparkToolsHint(access, scope, [])))?.name).toBe('spark');
    expect((await openSparkTools(access, scope, sparkToolsHint(access, scope, ['spark'])))?.name).toBe('spark_outpost');
    expect(sparkReserved(['notes'])).toEqual(['notes', 'spark', 'spark_outpost']);
  });

  it('knows whether the host has the Browser pane', async () => {
    expect((await openSparkTools(access, scope, sparkToolsHint(access, scope, [])))?.browser).toBe(false);
    const browsing = { ...access, browser: true };
    const hint = sparkToolsHint(browsing, scope, []);
    expect((await openSparkTools(browsing, scope, hint))?.browser).toBe(true);
  });

  it('sends Claude an HTTP server with the session token, but nothing to Codex or agents without HTTP', async () => {
    const tools = await openSparkTools(access, scope, sparkToolsHint(access, scope, []));
    expect(sparkAcpServer(tools, agentDefinitions.claude, withHttp)).toEqual({
      name: 'spark',
      config: expect.objectContaining({
        transport: 'http',
        url: grant.url,
        headers: { Authorization: 'Bearer tok-123' },
      }),
    });
    expect(sparkAcpServer(tools, agentDefinitions.codex, withHttp)).toBeNull();
    expect(sparkAcpServer(tools, agentDefinitions.claude, withoutHttp)).toBeNull();
    expect(sparkAcpServer(null, agentDefinitions.claude, withHttp)).toBeNull();
  });

  it('adds the server to CODEX_CONFIG next to the hidden user servers, approved without asking', async () => {
    const env = {
      CODEX_CONFIG: JSON.stringify({
        web_search: 'disabled',
        mcp_servers: { notes: { enabled: false } },
      }),
    };
    const config = JSON.parse(
      withCodexSparkServer(env, await openSparkTools(access, scope, sparkToolsHint(access, scope, []))).CODEX_CONFIG!,
    );
    expect(config).toEqual({
      web_search: 'disabled',
      mcp_servers: {
        notes: { enabled: false },
        spark: {
          url: grant.url,
          http_headers: { Authorization: 'Bearer tok-123' },
          default_tools_approval_mode: 'approve',
          tool_timeout_sec: 3600,
        },
      },
    });
    expect(withCodexSparkServer(env, null)).toBe(env);
  });

  it('gives a Claude tool call an hour before the pinned CLI gives up, where it had 60 seconds', async () => {
    const tools = await openSparkTools(access, scope, sparkToolsHint(access, scope, []));
    const meta = { claudeCode: { options: { tools: ['Read'], strictMcpConfig: true } } };
    const request = withSparkServer(
      { cwd: '/work/app', mcpServers: [], _meta: meta },
      sparkAcpServer(tools, agentDefinitions.claude, withHttp),
    );
    const sent = claudeServers(request);
    expect(sent).toEqual({
      spark: {
        type: 'http',
        url: grant.url,
        headers: { Authorization: 'Bearer tok-123' },
        timeout: HOUR_MS,
      },
    });
    expect(request.mcpServers).toEqual([]);
    expect(request._meta?.claudeCode).toMatchObject({
      options: { tools: ['Read'], strictMcpConfig: true },
    });
    expect(pinnedClaudeLimits({})).toMatchObject({ firstByteMs: 60_000, silentMs: 300_000 });
    const limits = pinnedClaudeLimits(sent.spark!);
    expect(limits).toEqual({ firstByteMs: HOUR_MS, silentMs: HOUR_MS, wallMs: HOUR_MS });
    expect(Math.min(...Object.values(limits))).toBeGreaterThan(FIVE_MINUTES_MS);
  });

  it('keeps the other Claude servers and sends an agent without Claude options the plain server', async () => {
    const tools = await openSparkTools(access, scope, sparkToolsHint(access, scope, []));
    const spark = sparkAcpServer(tools, agentDefinitions.claude, withHttp);
    const notes = { type: 'http', url: 'https://notes.example/mcp' };
    const meta = { claudeCode: { options: { mcpServers: { notes } } } };
    const kept = withSparkServer({ cwd: '/work/app', mcpServers: [], _meta: meta }, spark);
    expect(Object.keys(claudeServers(kept))).toEqual(['notes', 'spark']);
    const plain = withSparkServer({ cwd: '/work/app', mcpServers: [], _meta: null }, spark);
    expect(plain.mcpServers).toEqual([
      {
        type: 'http',
        name: 'spark',
        url: grant.url,
        headers: [{ name: 'Authorization', value: 'Bearer tok-123' }],
      },
    ]);
    const request = { cwd: '/work/app', mcpServers: [], _meta: meta };
    expect(withSparkServer(request, null)).toBe(request);
  });
});
