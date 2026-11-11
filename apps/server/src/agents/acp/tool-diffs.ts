import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk/unstable';
import { mentionsSecretFile } from '../../audit/redact.ts';
import type { ProviderDiff } from '../../providers/provider.ts';

type ToolUpdate = Extract<SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>;

export interface ToolDiffs {
  secret: boolean;
  byPath: Map<string, ProviderDiff>;
}

export function newToolDiffs(): ToolDiffs {
  return { secret: false, byPath: new Map() };
}

function withheld(path: string): ProviderDiff {
  return { path, withheld: true };
}

function diffItems(content: readonly ToolCallContent[] | null | undefined) {
  return (content ?? []).flatMap((item) => (item.type === 'diff' ? [item] : []));
}

export function noteToolDiffs(tool: ToolDiffs, update: ToolUpdate): void {
  tool.secret ||= mentionsSecretFile(update.rawInput ?? null);
  tool.secret ||= mentionsSecretFile(update.locations ?? null);
  for (const item of diffItems(update.content)) {
    const secret = tool.secret || mentionsSecretFile(item.path);
    tool.byPath.set(
      item.path,
      secret
        ? withheld(item.path)
        : { path: item.path, oldText: item.oldText ?? null, newText: item.newText },
    );
  }
}

export function finishedToolDiffs(tool: ToolDiffs): ProviderDiff[] {
  return [...tool.byPath.values()].map((diff) =>
    tool.secret && !('withheld' in diff) ? withheld(diff.path) : diff,
  );
}
