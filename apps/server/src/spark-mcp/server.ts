import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { redactText } from '../audit/redact.ts';
import type { SparkScope, SparkToolDeps } from './deps.ts';
import { renderResult } from './format.ts';
import { SparkToolError, type SparkTool, type SparkToolContext } from './tool.ts';
import { auditTool } from './tools/audit-tool.ts';
import { guideTool } from './tools/guide-tool.ts';
import { chatTools } from './tools/chat-tools.ts';
import { githubTools } from './tools/github-tools.ts';
import { projectTools } from './tools/project-tools.ts';
import { setupTools } from './tools/setup-tools.ts';
import { workTools } from './tools/work-tools.ts';

export const SPARK_MCP_NAME = 'spark';

export const SPARK_TOOLS: readonly SparkTool[] = [
  ...setupTools,
  ...projectTools,
  ...chatTools,
  auditTool,
  ...workTools,
  guideTool,
  ...githubTools,
];

const INSTRUCTIONS =
  'Tools about Spark Outpost itself, the app running this session: providers, connectors, projects, chats, audit, tickets, pull requests, analytics, activity, the brief, settings and a guide to how Spark works. They are read-only and never change anything. Results are JSON, paged and redacted.';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function failure(error: unknown): CallToolResult {
  const message =
    error instanceof SparkToolError
      ? error.message
      : error instanceof ZodError
        ? `Check the arguments: ${error.issues.map((issue) => issue.message).join('; ')}`
        : `Spark couldn't read that: ${(error as Error).message}`;
  return { isError: true, content: [{ type: 'text', text: redactText(message).slice(0, 500) }] };
}

export async function callSparkTool(
  tool: SparkTool,
  args: unknown,
  context: SparkToolContext,
): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: renderResult(await tool.run(args, context)) }] };
  } catch (error) {
    return failure(error);
  }
}

export function sparkMcpServer(deps: SparkToolDeps, scope: SparkScope): McpServer {
  const server = new McpServer(
    { name: 'spark-outpost', version: '1.0.0' },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );
  const context = { deps, scope };
  for (const tool of SPARK_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { title: tool.title, ...READ_ONLY },
      },
      (args: unknown) => callSparkTool(tool, args, context),
    );
  }
  return server;
}
