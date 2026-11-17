import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { AcpToolCallRenderer } from '@agentclientprotocol/claude-agent-acp/dist/tool-calls/renderer.js';

export interface RecordedTool {
  id: string;
  name: string;
  input: unknown;
}

const renderer = new AcpToolCallRenderer();

type ToolUse = Parameters<AcpToolCallRenderer['toolInfo']>[0];
type ToolResult = Parameters<AcpToolCallRenderer['resultFields']>[1];

function toolUse(tool: RecordedTool): ToolUse {
  return { id: tool.id, name: tool.name, input: tool.input ?? {} } as ToolUse;
}

const meta = (tool: RecordedTool) => ({ claudeCode: { toolName: tool.name } });

export function toolCallStarted(tool: RecordedTool, cwd: string): SessionUpdate {
  return {
    _meta: meta(tool),
    toolCallId: tool.id,
    sessionUpdate: 'tool_call',
    rawInput: tool.input ?? {},
    status: 'pending',
    ...renderer.toolInfo(toolUse(tool), cwd),
  } as SessionUpdate;
}

export function toolCallEnded(tool: RecordedTool, output: string, failed: boolean): SessionUpdate {
  const result = { type: 'tool_result', tool_use_id: tool.id, content: output, is_error: failed };
  const shown = {
    ...(renderer.resultFields(toolUse(tool), result as ToolResult) as Record<string, unknown>),
  };
  delete shown._meta;
  return {
    _meta: meta(tool),
    toolCallId: tool.id,
    sessionUpdate: 'tool_call_update',
    status: failed ? 'failed' : 'completed',
    rawOutput: output,
    ...shown,
  } as SessionUpdate;
}

export function permissionAsked(tool: RecordedTool, cwd: string): unknown {
  const toolCall = { ...(toolCallStarted(tool, cwd) as Record<string, unknown>) };
  delete toolCall.sessionUpdate;
  delete toolCall.status;
  return {
    jsonrpc: '2.0',
    id: `terminal-${tool.id}`,
    method: 'session/request_permission',
    params: { sessionId: '', toolCall, options: [] },
  };
}

export function sessionUpdateMessage(update: SessionUpdate): unknown {
  return { jsonrpc: '2.0', method: 'session/update', params: { sessionId: '', update } };
}
