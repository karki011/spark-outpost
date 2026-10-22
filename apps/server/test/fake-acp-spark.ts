import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import type * as acp from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

const SPARK_TRIGGER = /#spark (\w+)(?: (\{.*?\}))?/g;
const SCRIPT_TRIGGER = /#sparkscript (\[.*\])/;
const INSTRUCTIONS_TRIGGER = '#sparkinstructions';

type ScriptStep =
  { say: string } | { tool: string; args?: Record<string, unknown> } | { waitFor: string };

type Update = (value: acp.SessionUpdate) => Promise<void>;

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

function fromClaudeOptions(meta: unknown): SparkEndpoint | null {
  const options = (meta as { claudeCode?: { options?: { mcpServers?: unknown } } } | null)
    ?.claudeCode?.options;
  const servers = (options?.mcpServers ?? {}) as Record<
    string,
    { url?: string; headers?: Record<string, string> }
  >;
  for (const [name, server] of Object.entries(servers)) {
    const authorization = server.headers?.Authorization;
    if (name.startsWith('spark') && server.url && authorization) {
      return { name, url: server.url, authorization };
    }
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

async function sparkClient(endpoint: SparkEndpoint): Promise<Client> {
  const client = new Client({ name: 'fake-acp-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { Authorization: endpoint.authorization } },
    }) as Transport,
  );
  return client;
}

async function sayInstructions(endpoint: SparkEndpoint, say: (chunk: string) => Promise<void>) {
  const client = await sparkClient(endpoint);
  try {
    await say(`spark instructions=${client.getInstructions() ?? ''}`);
  } finally {
    await client.close();
  }
}

async function callSpark(
  endpoint: SparkEndpoint,
  call: { id: string; tool: string; args: Record<string, unknown> },
  update: Update,
): Promise<string> {
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: call.id,
    title: `mcp__${endpoint.name}__${call.tool}`,
    kind: 'other',
    status: 'in_progress',
    rawInput: call.args,
  });
  const client = await sparkClient(endpoint);
  try {
    const result = (await client.callTool({ name: call.tool, arguments: call.args })) as {
      content: acp.ContentBlock[];
    };
    const output = result.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const links = result.content.filter((block) => block.type === 'resource_link');
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId: call.id,
      status: 'completed',
      rawOutput: { text: output },
      ...(links.length > 0
        ? { content: links.map((link) => ({ type: 'content' as const, content: link })) }
        : {}),
    });
    return output;
  } finally {
    await client.close();
  }
}

async function scriptTurn(
  steps: readonly ScriptStep[],
  endpoint: SparkEndpoint,
  update: Update,
  say: (chunk: string) => Promise<void>,
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if ('say' in step) await say(step.say);
    else if ('waitFor' in step) {
      const gate = path.resolve(tmpdir(), step.waitFor);
      while (!existsSync(gate)) await pause(25);
    } else {
      const call = { id: `spark-script-${index}`, tool: step.tool, args: step.args ?? {} };
      await callSpark(endpoint, call, update);
    }
  }
}

export async function sparkTurn(
  text: string,
  session: { meta: unknown; mcpServers: unknown } | null,
  update: Update,
  say: (chunk: string) => Promise<void>,
): Promise<acp.StopReason | null> {
  const script = SCRIPT_TRIGGER.exec(text)?.[1];
  const match = [...text.matchAll(SPARK_TRIGGER)].at(-1);
  const instructions = !match && text.includes(INSTRUCTIONS_TRIGGER);
  if (!script && !match && !instructions) return null;
  const endpoint =
    fromAcp(session?.mcpServers) ??
    fromClaudeOptions(session?.meta) ??
    fromCodexConfig(process.env.CODEX_CONFIG);
  if (!endpoint) {
    await say('spark=missing');
    return 'end_turn';
  }
  if (instructions) {
    await sayInstructions(endpoint, say);
    return 'end_turn';
  }
  if (script) {
    await scriptTurn(JSON.parse(script) as ScriptStep[], endpoint, update, say);
    return 'end_turn';
  }
  const tool = match![1]!;
  const args = match![2] ? (JSON.parse(match![2]) as Record<string, unknown>) : {};
  const output = await callSpark(endpoint, { id: `spark-${tool}`, tool, args }, update);
  await say(`spark ${tool}=${output}`);
  return 'end_turn';
}
