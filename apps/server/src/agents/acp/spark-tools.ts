import type * as acp from '@agentclientprotocol/sdk';
import type { SparkScope } from '../../spark-mcp/deps.ts';
import type { SparkGrant, SparkMcpHost } from '../../spark-mcp/host.ts';
import { SPARK_MCP_NAME } from '../../spark-mcp/server.ts';
import { agentDefinitions, type AgentDefinition } from './agents.ts';
import { objectFields } from './object-fields.ts';
import type { SparkToolsHint } from './spark-instructions.ts';
import { acpMcpServer, supportsTransport, type NamedMcpServer } from './repo-session.ts';

export type SparkToolsAccess = Pick<SparkMcpHost, 'grant'> &
  Partial<Pick<SparkMcpHost, 'browser' | 'rebind'>>;

export interface SparkTools {
  name: string;
  grant: SparkGrant;
  browser: boolean;
}

export type AgentRuntime = 'acp' | 'fake';

export function sparkToolsOffered(runtime: AgentRuntime, provider: string): boolean {
  return runtime === 'acp' && Object.hasOwn(agentDefinitions, provider);
}

const FALLBACK_NAME = 'spark_outpost';
const CODEX_TOOL_TIMEOUT_SEC = 3_600;
const CLAUDE_TOOL_TIMEOUT_MS = CODEX_TOOL_TIMEOUT_SEC * 1_000;

export function sparkToolsHint(
  access: SparkToolsAccess | undefined,
  scope: SparkScope | undefined,
  reserved: readonly string[],
): SparkToolsHint | null {
  if (!access || !scope) return null;
  const name = reserved.includes(SPARK_MCP_NAME) ? FALLBACK_NAME : SPARK_MCP_NAME;
  return { name, browser: access.browser === true };
}

export async function openSparkTools(
  access: SparkToolsAccess | undefined,
  scope: SparkScope | undefined,
  hint: SparkToolsHint | null,
): Promise<SparkTools | null> {
  if (!access || !scope || !hint) return null;
  return { ...hint, grant: await access.grant(scope) };
}

export function sparkReserved(reserved: readonly string[]): string[] {
  return [...reserved, SPARK_MCP_NAME, FALLBACK_NAME];
}

function authorization(grant: SparkGrant): string {
  return `Bearer ${grant.token}`;
}

export function sparkAcpServer(
  tools: SparkTools | null,
  definition: AgentDefinition,
  init: acp.InitializeResponse,
): NamedMcpServer | null {
  if (!tools || definition.repoStyle === 'codex' || !supportsTransport(init, 'http')) return null;
  return {
    name: tools.name,
    config: {
      name: tools.name,
      transport: 'http',
      command: null,
      args: [],
      url: tools.grant.url,
      env: {},
      headers: { Authorization: authorization(tools.grant) },
      fingerprint: SPARK_MCP_NAME,
    },
  };
}

export function withSparkServer(
  request: acp.NewSessionRequest,
  spark: NamedMcpServer | null,
): acp.NewSessionRequest {
  if (!spark) return request;
  const meta = objectFields(request._meta);
  if (meta.claudeCode === undefined) {
    return { ...request, mcpServers: [...request.mcpServers, acpMcpServer(spark)] };
  }
  const claudeCode = objectFields(meta.claudeCode);
  const options = objectFields(claudeCode.options);
  const server = {
    type: spark.config.transport,
    url: spark.config.url,
    headers: spark.config.headers,
    timeout: CLAUDE_TOOL_TIMEOUT_MS,
  };
  const mcpServers = { ...objectFields(options.mcpServers), [spark.name]: server };
  return {
    ...request,
    _meta: { ...meta, claudeCode: { ...claudeCode, options: { ...options, mcpServers } } },
  };
}

export function withCodexSparkServer(
  env: Record<string, string>,
  tools: SparkTools | null,
): Record<string, string> {
  if (!tools) return env;
  const config = JSON.parse(env.CODEX_CONFIG ?? '{}') as Record<string, unknown>;
  const servers = (config.mcp_servers ?? {}) as Record<string, unknown>;
  const spark = {
    url: tools.grant.url,
    http_headers: { Authorization: authorization(tools.grant) },
    default_tools_approval_mode: 'approve',
    tool_timeout_sec: CODEX_TOOL_TIMEOUT_SEC,
  };
  return {
    ...env,
    CODEX_CONFIG: JSON.stringify({ ...config, mcp_servers: { ...servers, [tools.name]: spark } }),
  };
}
