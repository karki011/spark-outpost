import type * as acp from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const SPARK_TRIGGER = /#spark (\w+)(?: (\{.*?\}))?/;

interface SparkEndpoint {
  name: string;
  url: string;
  authorization: string;
}

function fromAcp(servers: unknown): SparkEndpoint | null {
  if (!Array.isArray(servers)) return null;
  for (const server of servers as acp.McpServer[]) {
    if (!('url' in server) || !server.name.startsWith('spark')) continue;
    const header = server.headers.find((entry) => entry.name === 'Authorization');
    if (header) return { name: server.name, url: server.url, authorization: header.value };
  }
  return null;
}

function fromCodexConfig(raw: string | undefined): SparkEndpoint | null {
  if (!raw) return null;
  const config = JSON.parse(raw) as {
    mcp_servers?: Record<string, { url?: string; http_headers?: Record<string, string> }>;
  };
  for (const [name, server] of Object.entries(config.mcp_servers ?? {})) {
    const authorization = server.http_headers?.Authorization;
    if (name.startsWith('spark') && server.url && authorization) {
      return { name, url: server.url, authorization };
    }
  }
  return null;
}

export async function sparkTurn(
  text: string,
  servers: unknown,
  update: (value: acp.SessionUpdate) => Promise<void>,
  say: (chunk: string) => Promise<void>,
): Promise<acp.StopReason | null> {
  const match = SPARK_TRIGGER.exec(text);
  if (!match) return null;
  const endpoint = fromAcp(servers) ?? fromCodexConfig(process.env.CODEX_CONFIG);
  if (!endpoint) {
    await say('spark=missing');
    return 'end_turn';
  }
  const tool = match[1]!;
  const args = match[2] ? (JSON.parse(match[2]) as Record<string, unknown>) : {};
  const toolCallId = `spark-${tool}`;
  await update({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: `mcp__${endpoint.name}__${tool}`,
    kind: 'other',
    status: 'in_progress',
    rawInput: args,
  });
  const client = new Client({ name: 'fake-acp-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { Authorization: endpoint.authorization } },
    }) as Transport,
  );
  try {
    const result = (await client.callTool({ name: tool, arguments: args })) as {
      content: { type: string; text?: string }[];
    };
    const output = result.content.map((block) => block.text ?? '').join('');
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      rawOutput: { text: output },
    });
    await say(`spark ${tool}=${output}`);
  } finally {
    await client.close();
  }
  return 'end_turn';
}
