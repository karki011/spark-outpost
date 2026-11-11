import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk/unstable';
import {
  approvalOptionKindSchema,
  type ApprovalKind,
  type ApprovalOption,
  type FileDiff,
} from '@spark-outpost/contracts';
import { splitCommandLine } from '../../approvals/commands.ts';
import type { ApprovalRequest, RequestRoot } from '../../approvals/decide.ts';
import { exitPlanText, isExitPlanKind } from '../../plans/plan-mode.ts';
import type { GateAnswer } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';
import { toolNameOf } from './tool-titles.ts';

export interface RequestContext {
  rpcId: string | null;
  roots: readonly RequestRoot[];
  cwd: string;
  home: string;
  mode?: string | null;
  shownPlan?: string | null;
  subagent?: string | null;
  attachedFiles?: readonly string[];
}

const EDIT_KINDS = new Set(['edit', 'delete', 'move']);

function monitorCommand(toolName: string | null, rawInput: Record<string, unknown>) {
  if (toolName !== 'Monitor') return null;
  return typeof rawInput.command === 'string' && rawInput.command.trim() ? rawInput.command : null;
}

function kindOf(
  toolKind: string | null,
  toolName: string | null,
  rawInput: Record<string, unknown>,
): ApprovalKind {
  if (toolName === 'NotebookEdit') return 'edit';
  if (toolKind === 'execute' || monitorCommand(toolName, rawInput)) return 'execute';
  if (toolKind && EDIT_KINDS.has(toolKind)) return 'edit';
  return 'other';
}

function addressOf(toolName: string | null, rawInput: Record<string, unknown>): string | null {
  const address =
    toolName === 'WebFetch'
      ? rawInput.url
      : toolName === 'Monitor'
        ? objectFields(rawInput.ws).url
        : null;
  return typeof address === 'string' ? address : null;
}

function quotedScript(command: string): string | null {
  if (!/^["']/.test(command.trim())) return null;
  const parts = splitCommandLine(command);
  const script = parts.length === 1 && parts[0]!.tokens.length === 1 ? parts[0]!.tokens[0]! : null;
  return script !== null && /\s/.test(script.trim()) ? script : null;
}

function commandOf(rawInput: Record<string, unknown>, title: string): string | null {
  const command = rawInput.command ?? rawInput.cmd;
  if (typeof command === 'string' && command.trim()) return quotedScript(command) ?? command;
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) {
    return command.join(' ');
  }
  return title.trim() || null;
}

function absolute(target: string, cwd: string): string {
  return path.resolve(cwd, target);
}

function diffsOf(content: acp.ToolCallContent[] | null | undefined, cwd: string): FileDiff[] {
  return (content ?? []).flatMap((item) =>
    item.type === 'diff'
      ? [{ path: absolute(item.path, cwd), oldText: item.oldText ?? null, newText: item.newText }]
      : [],
  );
}

function pathsOf(
  toolCall: acp.ToolCallUpdate,
  rawInput: Record<string, unknown>,
  diffs: readonly FileDiff[],
  cwd: string,
): string[] {
  const candidates = [
    ...(toolCall.locations ?? []).map((location) => location.path),
    ...diffs.map((diff) => diff.path),
    ...[rawInput.file_path, rawInput.path, rawInput.notebook_path].filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    ),
  ];
  return [...new Set(candidates.map((candidate) => absolute(candidate, cwd)))];
}

const MCP_TITLE = /^mcp__(.+?)__/;

function unaskedMcpServer(toolCall: acp.ToolCallUpdate): string | null {
  if (objectFields(toolCall._meta).is_mcp_tool_call !== true) return null;
  const server = objectFields(toolCall.rawInput).server;
  return typeof server === 'string' && server.trim() ? server.trim() : null;
}

function mcpServerOf(params: acp.RequestPermissionRequest, title: string): string | null {
  const claude = objectFields(objectFields(params.toolCall._meta).claudeCode).mcpServer;
  const claudeName = objectFields(claude).name;
  if (typeof claudeName === 'string' && claudeName.trim()) return claudeName.trim();
  const titled = MCP_TITLE.exec(title)?.[1];
  if (titled) return titled;
  const called = unaskedMcpServer(params.toolCall);
  if (called) return called;
  if (objectFields(params._meta).is_mcp_tool_approval !== true) return null;
  const serverName = objectFields(params.toolCall.rawInput).serverName;
  return typeof serverName === 'string' && serverName.trim() ? serverName.trim() : 'unknown';
}

const REASON_PREFIX = /^Reason:\s*/i;
const AGENT_REASON_MAX = 500;

function agentReasonOf(params: acp.RequestPermissionRequest): string | null {
  const meta = objectFields(params._meta);
  const air = objectFields(objectFields(meta.jetbrains).air);
  const permission = objectFields(air.permission ?? meta.permission);
  const description = permission.description;
  if (typeof description !== 'string') return null;
  const reason = description.replace(REASON_PREFIX, '').trim();
  return reason ? reason.slice(0, AGENT_REASON_MAX) : null;
}

function approvalOptions(options: readonly acp.PermissionOption[]): ApprovalOption[] {
  return options.flatMap((option) => {
    const kind = approvalOptionKindSchema.safeParse(option.kind);
    return kind.success ? [{ optionId: option.optionId, name: option.name, kind: kind.data }] : [];
  });
}

export function approvalRequestFrom(
  params: acp.RequestPermissionRequest,
  context: RequestContext,
): ApprovalRequest {
  const { toolCall } = params;
  const toolKind = toolCall.kind ?? null;
  const toolName = toolNameOf(toolCall);
  const rawInput = objectFields(toolCall.rawInput);
  const kind = kindOf(toolKind, toolName, rawInput);
  const address = addressOf(toolName, rawInput);
  const title = toolCall.title?.trim() || 'an action';
  const cwdInput = rawInput.cwd;
  const cwd = typeof cwdInput === 'string' && path.isAbsolute(cwdInput) ? cwdInput : context.cwd;
  const diffs = diffsOf(toolCall.content, cwd);
  const plan =
    exitPlanText(toolKind, toolCall.rawInput, toolCall.content) ??
    (isExitPlanKind(toolKind) ? (context.shownPlan ?? null) : null);
  const options = approvalOptions(params.options);
  const mcpServer = mcpServerOf(params, title);
  const agentReason = agentReasonOf(params);
  return {
    toolCallId: toolCall.toolCallId,
    rpcId: context.rpcId,
    kind,
    toolKind,
    title,
    command: kind === 'execute' ? commandOf(rawInput, title) : null,
    cwd: kind === 'execute' ? cwd : null,
    paths: kind === 'execute' ? [] : pathsOf(toolCall, rawInput, diffs, cwd),
    diffs,
    options,
    roots: context.roots,
    home: context.home,
    ...(plan ? { plan } : {}),
    ...(address !== null ? { address } : {}),
    ...(mcpServer ? { mcpServer } : {}),
    ...(agentReason ? { agentReason } : {}),
    ...(context.subagent ? { subagent: context.subagent } : {}),
    ...(context.attachedFiles?.length ? { attachedFiles: context.attachedFiles } : {}),
    ...(context.mode !== undefined ? { mode: context.mode } : {}),
  };
}

export function permissionResponse(answer: GateAnswer): acp.RequestPermissionResponse {
  if (answer.outcome !== 'selected') return { outcome: { outcome: 'cancelled' } };
  const selected = { outcome: 'selected' as const, optionId: answer.optionId };
  return answer.denial
    ? { outcome: selected, _meta: { denyMessage: answer.denial } }
    : { outcome: selected };
}
