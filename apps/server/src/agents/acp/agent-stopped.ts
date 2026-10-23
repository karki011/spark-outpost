import type * as acp from '@agentclientprotocol/sdk';
import type { RailKind } from '@spark-outpost/contracts';
import type { AgentCli } from './agent-cli.ts';
import { objectFields } from './object-fields.ts';

const FENCE = /^```[a-z]*\n([\s\S]*)\n```$/;
const SANDBOX_REFUSAL = 'Operation not permitted';

function texts(toolCall: acp.ToolCallUpdate): string[] {
  return (toolCall.content ?? []).flatMap((item) => {
    const block = objectFields(objectFields(item).content);
    return typeof block.text === 'string' ? [block.text.trim()] : [];
  });
}

function unfenced(text: string): string {
  return (FENCE.exec(text)?.[1] ?? text).trim();
}

function claudeDenial(toolCall: acp.ToolCallUpdate, command: string | null): boolean {
  const shown = texts(toolCall).map(unfenced);
  if (shown.length !== 1) return false;
  const [text] = shown as [string];
  if (command !== null)
    return text === `Permission to use Bash with command ${command} has been denied.`;
  return toolCall.kind !== 'execute' && /^Permission to [^\n]+ has been denied\.$/.test(text);
}

export function stoppedByAgent(
  cli: AgentCli | null,
  rail: RailKind,
  toolCall: acp.ToolCallUpdate,
  command: string | null,
  failed: boolean,
): boolean {
  if (cli === 'claude') return failed && claudeDenial(toolCall, command);
  if (cli === 'codex' && rail === 'browser_data') {
    return texts(toolCall).some((text) => text.includes(SANDBOX_REFUSAL));
  }
  return false;
}
