import type * as acp from '@agentclientprotocol/sdk';
import type { SparkScope } from '../../spark-mcp/deps.ts';
import type { SparkGrant, SparkMcpHost } from '../../spark-mcp/host.ts';
import { SPARK_MCP_NAME } from '../../spark-mcp/server.ts';
import { agentDefinitions, type AgentDefinition } from './agents.ts';
import { supportsTransport, type NamedMcpServer } from './repo-session.ts';

export type SparkToolsAccess = Pick<SparkMcpHost, 'grant'> & Partial<Pick<SparkMcpHost, 'browser'>>;

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

export async function openSparkTools(
  access: SparkToolsAccess | undefined,
  scope: SparkScope | undefined,
  reserved: readonly string[],
): Promise<SparkTools | null> {
  if (!access || !scope) return null;
  const name = reserved.includes(SPARK_MCP_NAME) ? FALLBACK_NAME : SPARK_MCP_NAME;
  return { name, grant: await access.grant(scope), browser: access.browser === true };
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
