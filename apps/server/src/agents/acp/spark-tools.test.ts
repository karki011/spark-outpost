import { describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { agentDefinitions } from './agents.ts';
import {
  openSparkTools,
  sparkAcpServer,
  sparkReserved,
  withCodexSparkServer,
} from './spark-tools.ts';

const scope = { workspaceId: 'w', conversationId: 'c', runId: 'r' };
const grant = { url: 'http://127.0.0.1:5555/mcp', token: 'tok-123', revoke: () => undefined };
const access = { grant: () => grant };
const withHttp = {
  agentCapabilities: { mcpCapabilities: { http: true } },
} as acp.InitializeResponse;
const withoutHttp = { agentCapabilities: {} } as acp.InitializeResponse;

describe('Spark tools for agent sessions', () => {
  it('opens only with a host and a scope, and steps aside from a Codex server called spark', () => {
    expect(openSparkTools(undefined, scope, [])).toBeNull();
    expect(openSparkTools(access, undefined, [])).toBeNull();
    expect(openSparkTools(access, scope, [])?.name).toBe('spark');
    expect(openSparkTools(access, scope, ['spark'])?.name).toBe('spark_outpost');
    expect(sparkReserved(['notes'])).toEqual(['notes', 'spark', 'spark_outpost']);
  });

  it('sends Claude an HTTP server with the session token, but nothing to Codex or agents without HTTP', () => {
    const tools = openSparkTools(access, scope, []);
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

  it('adds the server to CODEX_CONFIG next to the hidden user servers, approved without asking', () => {
    const env = {
      CODEX_CONFIG: JSON.stringify({
        web_search: 'disabled',
        mcp_servers: { notes: { enabled: false } },
      }),
    };
    const config = JSON.parse(
      withCodexSparkServer(env, openSparkTools(access, scope, [])).CODEX_CONFIG!,
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
});
