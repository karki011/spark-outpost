import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import {
  approvalOptionKindSchema,
  type ApprovalKind,
  type ApprovalOption,
  type FileDiff,
} from '@spark-outpost/contracts';
import type { ApprovalRequest, RequestRoot } from '../../approvals/decide.ts';
import { exitPlanText } from '../../plans/plan-mode.ts';
import type { GateAnswer } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';

export interface RequestContext {
  rpcId: string | null;
  roots: readonly RequestRoot[];
  cwd: string;
  home: string;
  mode?: string | null;
}

const EDIT_KINDS = new Set(['edit', 'delete', 'move']);

function kindOf(toolKind: string | null): ApprovalKind {
  if (toolKind === 'execute') return 'execute';
  if (toolKind && EDIT_KINDS.has(toolKind)) return 'edit';
  return 'other';
}

function commandOf(rawInput: Record<string, unknown>, title: string): string | null {
  const command = rawInput.command ?? rawInput.cmd;
  if (typeof command === 'string' && command.trim()) return command;
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

function mcpServerOf(params: acp.RequestPermissionRequest, title: string): string | null {
  const claude = objectFields(objectFields(params.toolCall._meta).claudeCode).mcpServer;
  const claudeName = objectFields(claude).name;
  if (typeof claudeName === 'string' && claudeName.trim()) return claudeName.trim();
  const titled = MCP_TITLE.exec(title)?.[1];
  if (titled) return titled;
  if (objectFields(params._meta).is_mcp_tool_approval !== true) return null;
  const serverName = objectFields(params.toolCall.rawInput).serverName;
  return typeof serverName === 'string' && serverName.trim() ? serverName.trim() : 'unknown';
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
  const kind = kindOf(toolKind);
  const rawInput = objectFields(toolCall.rawInput);
  const title = toolCall.title?.trim() || 'an action';
  const cwdInput = rawInput.cwd;
  const cwd = typeof cwdInput === 'string' && path.isAbsolute(cwdInput) ? cwdInput : context.cwd;
  const diffs = diffsOf(toolCall.content, cwd);
  const plan = exitPlanText(toolKind, toolCall.rawInput, toolCall.content);
  const options = approvalOptions(params.options);
  const mcpServer = mcpServerOf(params, title);
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
    ...(mcpServer ? { mcpServer } : {}),
    ...(context.mode !== undefined ? { mode: context.mode } : {}),
  };
}

export function permissionResponse(answer: GateAnswer): acp.RequestPermissionResponse {
  return answer.outcome === 'selected'
    ? { outcome: { outcome: 'selected', optionId: answer.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
