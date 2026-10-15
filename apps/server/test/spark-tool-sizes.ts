import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EVERYTHING_AVAILABLE, type SparkAvailability } from '../src/spark-mcp/availability.ts';
import type { SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { SPARK_TOOLS, sparkMcpServer } from '../src/spark-mcp/server.ts';

const NOTHING_AVAILABLE: SparkAvailability = {
  tickets: false,
  slack: false,
  pull_requests: false,
  project: false,
  publish: false,
  pull_request_create: false,
  browser: false,
  mac: false,
  outpost: false,
  outpost_draft: false,
};

export const SESSION_CASES = {
  'plain chat, nothing connected': NOTHING_AVAILABLE,
  'linked project, GitHub connected': {
    ...NOTHING_AVAILABLE,
    project: true,
    publish: true,
    pull_requests: true,
    outpost_draft: true,
  },
  'chat in an outpost, nothing connected': {
    ...NOTHING_AVAILABLE,
    outpost: true,
    outpost_draft: true,
  },
  'everything connected, Browser pane': EVERYTHING_AVAILABLE,
} satisfies Record<string, SparkAvailability>;

export type SessionCase = keyof typeof SESSION_CASES;

export interface AdvertisedSize {
  tools: number;
  chars: number;
  tokens: number;
  instructionChars: number;
  groups: Record<string, number>;
}

const SCOPE = { workspaceId: 'budget', conversationId: 'budget', runId: null };

function groupOf(name: string): string {
  const tool = SPARK_TOOLS.find((candidate) => candidate.name === name);
  if (tool?.needs) return tool.needs;
  if (name.includes('mcp_server')) return 'mcp_servers';
  if (/_sparks?$/.test(name)) return 'sparks';
  return 'other';
}

export const estimatedTokens = (chars: number) => Math.ceil(chars / 4);

export async function advertisedSize(available: SparkAvailability): Promise<AdvertisedSize> {
  const server = sparkMcpServer({} as SparkToolDeps, SCOPE, available);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'spark-tool-sizes', version: '1.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  const listed = await client.listTools();
  const instructionChars = client.getInstructions()?.length ?? 0;
  await client.close();
  await server.close();
  const groups: Record<string, number> = {};
  for (const tool of listed.tools) {
    const definition = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    };
    const group = groupOf(tool.name);
    groups[group] = (groups[group] ?? 0) + JSON.stringify(definition).length;
  }
  const chars = Object.values(groups).reduce((sum, size) => sum + size, 0);
  return {
    tools: listed.tools.length,
    chars,
    tokens: estimatedTokens(chars),
    instructionChars,
    groups,
  };
}
