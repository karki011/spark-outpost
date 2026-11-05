import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { UserMcpLaunch } from '../src/mcp/launch.ts';
import type { ProviderOutput, ProviderTurn } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

const claude: AgentDefinition = { ...agentDefinitions.claude, conversationMode: 'read-only' };
const codex: AgentDefinition = { ...agentDefinitions.codex, conversationMode: 'read-only' };

let t: TestDb;
let host: SparkMcpHost;

beforeEach(async () => {
  t = await createTestDb();
  host = await startSparkMcpHost(toolDeps(t));
});

afterEach(async () => {
  await host.close();
  await t.cleanup();
});

interface Session {
  meta: {
    claudeCode: {
      options: {
        settings: { permissions: { ask?: string[]; allow?: string[] } };
        mcpServers?: Record<string, { url: string; headers: { Authorization: string } }>;
      };
    };
    systemPrompt?: { append: string };
  } | null;
  mcpServers: { name: string; url?: string; headers?: { name: string; value: string }[] }[];
  codexConfig: string | null;
}

async function run(
  definition: AgentDefinition,
  prompt: string,
  extra: Partial<ProviderTurn> & { http?: boolean } = {},
) {
  const { http = true, ...turnExtra } = extra;
  const env = {
    ...childEnvironment(process.env),
    CODEX_HOME: '/nonexistent-codex-home',
    ...(http ? { FAKE_ACP_MCP_CAPABILITIES: JSON.stringify({ http: true, sse: false }) } : {}),
  };
  const provider = createAcpProvider({
    definition,
    launch,
    cancelGraceMs: 2_000,
    env,
    sparkTools: host,
  });
  const outputs: ProviderOutput[] = [];
  const audited: unknown[] = [];
  for await (const output of provider.run({
    prompt,
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    signal: new AbortController().signal,
    audit: { message: (_direction, message) => audited.push(message), stderr: () => undefined },
    sparkScope: { workspaceId: t.workspaceId, conversationId: null, runId: null },
    ...turnExtra,
  })) {
    outputs.push(output);
  }
  return { text: replyText(outputs), outputs, audited };
}

async function session(
  definition: AgentDefinition,
  extra: Partial<ProviderTurn> & { http?: boolean } = {},
) {
  const { text } = await run(definition, '#session', extra);
  return JSON.parse(text.slice(text.indexOf('session=') + 'session='.length)) as Session;
}

const githubMcp: UserMcpLaunch = {
  id: '00000000-0000-4000-8000-0000000000b1',
  name: 'spark',
  transport: 'stdio',
  command: 'their-spark',
  args: [],
  url: null,
  envNames: [],
  headerNames: [],
  fingerprint: 'fp',
};

describe('Spark tools in agent sessions', { timeout: 30_000 }, () => {
  it('gives Claude the Spark server over HTTP, allowed without an approval ask', async () => {
    const received = await session(claude);

    const spark = received.meta!.claudeCode.options.mcpServers?.spark;
    expect(spark).toMatchObject({
      type: 'http',
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
      headers: { Authorization: expect.stringMatching(/^Bearer /) },
      timeout: 3_600_000,
    });
    expect(received.mcpServers).toEqual([]);
    const permissions = received.meta!.claudeCode.options.settings.permissions;
    expect(permissions.allow).toContain('mcp__spark');
    expect(permissions.ask ?? []).not.toContain('mcp__spark');
  });

  it('answers a Spark tool call in the session and audits it like other tool calls', async () => {
    await connectCliProvider(t, 'claude');

    const { text, audited } = await run(claude, '#spark spark_providers');

    expect(text).toContain('spark spark_providers=');
    expect(text).toContain('"local CLI login"');
    expect(JSON.stringify(audited)).toContain('mcp__spark__spark_providers');
  });

  it('revokes the session token when the turn ends', async () => {
    const received = await session(claude);
    const spark = received.meta!.claudeCode.options.mcpServers!.spark!;

    const response = await fetch(spark.url, {
      method: 'POST',
      headers: {
        Authorization: spark.headers.Authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
  });

  it('renames a user MCP server called spark so it never takes the allowed name', async () => {
    const received = await session(claude, { userMcp: [githubMcp] });

    expect(received.mcpServers.map((server) => server.name)).toEqual(['spark_spark']);
    expect(Object.keys(received.meta!.claudeCode.options.mcpServers ?? {})).toEqual(['spark']);
    expect(received.meta!.claudeCode.options.settings.permissions.allow).toEqual(['mcp__spark']);
  });

  it('skips the Spark server quietly for an agent without HTTP MCP', async () => {
    const { text } = await run(claude, '#spark spark_settings', { http: false });

    expect(text).toContain('spark=missing');
    expect(text).not.toContain("can't use");
  });

  it('gives Codex the Spark server through its config with tool approval set to approve', async () => {
    const received = await session(codex, {
      spark: { displayName: 'Alex', personality: 'friendly' },
    });

    expect(received.mcpServers.map((server) => server.name)).not.toContain('spark');
    const config = JSON.parse(received.codexConfig!) as {
      mcp_servers: Record<string, Record<string, unknown>>;
      developer_instructions: string;
    };
    expect(config.mcp_servers.spark).toMatchObject({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
      default_tools_approval_mode: 'approve',
    });
    expect(config.developer_instructions).toContain('spark_* tools');
    const { text } = await run(codex, '#spark spark_settings');
    expect(text).toContain('defaultAutonomy');
  });
});
