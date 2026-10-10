import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';

interface FloorTurn {
  text: string;
  sessionId: string;
  cwd: string;
  client: acp.AgentContext;
  update(value: acp.SessionUpdate): Promise<void>;
}

const EDIT_RULE = /^Edit\((.+)\)$/;

function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function sessionAskRules(meta: unknown): string[] {
  const options = fieldsOf(fieldsOf(fieldsOf(meta).claudeCode).options);
  const ask = fieldsOf(fieldsOf(options.settings).permissions).ask;
  return Array.isArray(ask) ? ask.filter((rule) => typeof rule === 'string') : [];
}

export function asksBeforeEditing(rules: readonly string[], cwd: string, target: string): boolean {
  return rules.some((rule) => {
    const glob = EDIT_RULE.exec(rule)?.[1];
    if (!glob) return false;
    return glob.startsWith('//')
      ? matchesGlob(target, glob.slice(1))
      : matchesGlob(relative(cwd, target), glob);
  });
}

const OPTIONS: acp.PermissionOption[] = [
  { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
  { optionId: 'no', name: 'No', kind: 'reject_once' },
];

async function previous(target: string): Promise<string | null> {
  return readFile(target, 'utf8').catch(() => null);
}

async function editFile(
  turn: FloorTurn,
  rules: readonly string[],
  relativePath: string,
  newText: string,
): Promise<void> {
  const target = join(turn.cwd, relativePath);
  const toolCallId = `floor-edit-${relativePath}`;
  const call = {
    toolCallId,
    title: `Edit ${relativePath}`,
    kind: 'edit' as const,
    status: 'pending' as const,
    locations: [{ path: target }],
    content: [{ type: 'diff' as const, path: target, oldText: await previous(target), newText }],
  };
  await turn.update({ sessionUpdate: 'tool_call', ...call });
  if (asksBeforeEditing(rules, turn.cwd, target)) {
    const request: acp.RequestPermissionRequest = {
      sessionId: turn.sessionId,
      toolCall: call,
      options: OPTIONS,
    };
    const answer = await turn.client.request(acp.methods.client.session.requestPermission, request);
    if (answer.outcome.outcome !== 'selected' || answer.outcome.optionId !== 'yes') {
      await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' });
      return;
    }
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, newText);
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
}

async function ranUnasked(
  turn: FloorTurn,
  toolCallId: string,
  call: Pick<acp.ToolCall, 'title' | 'kind' | 'rawInput' | 'locations'>,
): Promise<void> {
  await turn.update({ sessionUpdate: 'tool_call', toolCallId, status: 'in_progress', ...call });
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
}

export const HOOK_APPEND = "printf 'exit 0\\n' >> .git/hooks/pre-push";
export const RULES_APPEND = 'echo more >> AGENTS.md';
export const ORDINARY_COMMAND = 'pnpm vitest run src';

export async function floorTurn(turn: FloorTurn, meta: unknown): Promise<void> {
  const rules = sessionAskRules(meta);
  if (turn.text.includes('#floorrules')) {
    await editFile(turn, rules, 'AGENTS.md', '# Changed by the agent\n');
  }
  if (turn.text.includes('#floorhook')) {
    await editFile(turn, rules, '.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  }
  if (turn.text.includes('#floorordinary')) {
    await editFile(turn, rules, 'notes.txt', 'changed\n');
    await ranUnasked(turn, 'floor-command', {
      title: ORDINARY_COMMAND,
      kind: 'execute',
      rawInput: { command: ORDINARY_COMMAND },
    });
    await ranUnasked(turn, 'floor-read', {
      title: 'Read notes.txt',
      kind: 'read',
      locations: [{ path: join(turn.cwd, 'notes.txt') }],
    });
  }
  if (turn.text.includes('#floorshell')) {
    await writeFile(join(turn.cwd, 'AGENTS.md'), '# Rules\nmore\n');
    await ranUnasked(turn, 'floor-shell-rules', {
      title: RULES_APPEND,
      kind: 'execute',
      rawInput: { command: RULES_APPEND },
    });
    await mkdir(join(turn.cwd, '.git/hooks'), { recursive: true });
    await writeFile(join(turn.cwd, '.git/hooks/pre-push'), 'exit 0\n');
    await ranUnasked(turn, 'floor-shell-hook', {
      title: HOOK_APPEND,
      kind: 'execute',
      rawInput: { command: HOOK_APPEND },
    });
  }
}
