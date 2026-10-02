import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { redactText } from '../audit/redact.ts';
import type { SparkScope, SparkToolDeps } from './deps.ts';
import { renderResult } from './format.ts';
import { SparkToolError, type SparkTool, type SparkToolContext } from './tool.ts';
import { pullRequestActionTool } from './actions/pr-action.ts';
import { prFollowUpRoundTool } from './actions/pr-follow-up-action.ts';
import { ticketActionTools } from './actions/ticket-actions.ts';
import { createTeammateTool, updateTeammateTool } from './actions/teammate-actions.ts';
import { attentionTool } from './tools/attention-tool.ts';
import { auditTool } from './tools/audit-tool.ts';
import { docsTool } from './tools/docs-tool.ts';
import { guideTool } from './tools/guide-tool.ts';
import { chatTools } from './tools/chat-tools.ts';
import { historyTool } from './tools/history-tool.ts';
import { githubTools } from './tools/github-tools.ts';
import { prFollowUpTool } from './tools/pr-follow-up-tool.ts';
import { projectTools } from './tools/project-tools.ts';
import { runTool } from './tools/run-tool.ts';
import { lawsTool } from './tools/laws-tool.ts';
import { setupTools } from './tools/setup-tools.ts';
import { taskTool } from './tools/task-tool.ts';
import { teammatesTool } from './tools/teammates-tool.ts';
import { terminalTool } from './tools/terminal-tool.ts';
import { usageTools } from './tools/usage-tools.ts';
import { workTools } from './tools/work-tools.ts';

export const SPARK_MCP_NAME = 'spark';

export const SPARK_TOOLS: readonly SparkTool[] = [
  ...setupTools,
  ...projectTools,
  ...chatTools,
  historyTool,
  attentionTool,
  runTool,
  lawsTool,
  taskTool,
  auditTool,
  ...workTools,
  ...usageTools,
  terminalTool,
  teammatesTool,
  guideTool,
  docsTool,
  ...githubTools,
  prFollowUpTool,
  ...ticketActionTools,
  pullRequestActionTool,
  prFollowUpRoundTool,
  createTeammateTool,
  updateTeammateTool,
];

const INSTRUCTIONS =
  'Tools about Spark Outpost itself, the app running this session: what needs the user, chats and their full history (including turns compacted out of context), live runs (crew, pieces, Jev decisions), plans and files changed, audit, spend, analytics and outcomes, model cards, providers, connectors, projects and the Map, terminals, tickets, pull requests and the follow-up on them, estimates, budgets and guardrail findings, activity, the brief, settings, Sparks (named teammates with their state and standing instructions), a guide to how Spark works (spark_guide section spark-tools says which tool answers what) and the user guide with step-by-step how-tos (spark_docs). The read tools never change anything. The action tools (create, comment on, move or assign a ticket; open a PR; request a PR follow-up round; add or change a Spark) only propose: the user confirms each one on a card before Spark does it. Results are JSON, paged and redacted.';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const CONFIRMED_ACTION = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
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
    const text = renderResult(await tool.run(args, context));
    if (tool.privateData) {
      context.scope.observations?.record({
        source: 'private_data',
        label: `private work data (${tool.name})`,
      });
    }
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return failure(error);
  }
}

export function sparkToolsFor(scope: Pick<SparkScope, 'readOnly'>): readonly SparkTool[] {
  return scope.readOnly ? SPARK_TOOLS.filter((tool) => !tool.acts) : SPARK_TOOLS;
}

export function sparkMcpServer(
  deps: SparkToolDeps,
  scope: SparkScope,
  stopped?: AbortSignal,
): McpServer {
  const server = new McpServer(
    { name: 'spark-outpost', version: '1.0.0' },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );
  const context = { deps, scope };
  for (const tool of sparkToolsFor(scope)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { title: tool.title, ...(tool.acts ? CONFIRMED_ACTION : READ_ONLY) },
      },
      (args: unknown, extra: { signal: AbortSignal }) =>
        callSparkTool(tool, args, {
          ...context,
          signal: stopped ? AbortSignal.any([extra.signal, stopped]) : extra.signal,
        }),
    );
  }
  return server;
}
