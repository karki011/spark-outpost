import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { objectFields } from './object-fields.ts';

const CHANGES = new Set(['edit', 'delete', 'move']);
const HANDBACK_TOOL = 'SubagentHandback';

export interface ActivitySeen {
  files?: string[];
  commands?: string[];
}

export interface SubagentActivity {
  see(update: SessionUpdate): ActivitySeen | null;
  lastMessage(): string | null;
}

function commandOf(rawInput: unknown): string | null {
  const command = objectFields(rawInput).command ?? objectFields(rawInput).cmd;
  if (typeof command === 'string' && command.trim()) return command.trim();
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) {
    return command.join(' ').trim() || null;
  }
  return null;
}

export function createSubagentActivity(): SubagentActivity {
  const kinds = new Map<string, string>();
  const files = new Set<string>();
  const ran = new Set<string>();
  let messageId: string | null = null;
  let said = '';
  let handedBack: string | null = null;

  const hear = (update: Extract<SessionUpdate, { sessionUpdate: 'agent_message_chunk' }>) => {
    if (update.content.type !== 'text') return;
    const id = update.messageId ?? null;
    if (id !== messageId) said = '';
    messageId = id;
    said += update.content.text;
  };

  const newFiles = (paths: readonly string[]): string[] => {
    const added = paths.filter((path) => !files.has(path));
    added.forEach((path) => files.add(path));
    return added;
  };

  return {
    see(update) {
      if (update.sessionUpdate === 'agent_message_chunk') {
        hear(update);
        return null;
      }
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
        return null;
      }
      const id = update.toolCallId;
      if (update.kind) kinds.set(id, update.kind);
      const kind = kinds.get(id);
      if (objectFields(objectFields(update._meta).claudeCode).toolName === HANDBACK_TOOL) {
        const message = objectFields(update.rawInput).message;
        if (typeof message === 'string' && message.trim()) handedBack = message.trim();
      }
      const changed =
        kind && CHANGES.has(kind)
          ? newFiles((update.locations ?? []).map((location) => location.path))
          : [];
      const command = kind === 'execute' && !ran.has(id) ? commandOf(update.rawInput) : null;
      if (command) ran.add(id);
      if (changed.length === 0 && !command) return null;
      return {
        ...(changed.length > 0 ? { files: changed } : {}),
        ...(command ? { commands: [command] } : {}),
      };
    },
    lastMessage: () => handedBack ?? (said.trim() || null),
  };
}
