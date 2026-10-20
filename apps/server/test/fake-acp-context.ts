import type * as acp from '@agentclientprotocol/sdk';
import { recordContext, sessionContext } from './fake-acp-sessions.ts';

const advertisedCommands = JSON.parse(process.env.FAKE_ACP_COMMANDS ?? '[]') as string[];
const contextSize = Number(process.env.FAKE_ACP_CONTEXT_SIZE ?? 0);

const CONTEXT_TRIGGER = /#ctx(\d{1,3})\b/;
export const SELF_COMPACT_TRIGGER = '#selfcompact';
const SUMMARY_HEADING = '# Compacted chat summary';
export const FAKE_ACP_COMPACT_REPLY = 'Compacted: kept the requests and open work.';

type Update = (value: acp.SessionUpdate) => Promise<void>;
type Say = (chunk: string) => Promise<void>;

function slashCommand(prompt: acp.ContentBlock[]): { name: string; rest: string } | null {
  const first = prompt[0];
  if (first?.type !== 'text') return null;
  const trimmed = first.text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [name = '', ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: name.toLowerCase(), rest: rest.join(' ') };
}

function percentOf(used: number): number {
  return Math.round((used / contextSize) * 100);
}

function nextUsed(sessionId: string, request: string): number {
  const at = (percent: number) => Math.round((contextSize * percent) / 100);
  if (request.trim().startsWith('/compact')) return at(8);
  if (request.includes(SELF_COMPACT_TRIGGER)) return at(10);
  if (request.includes(SUMMARY_HEADING)) return at(5);
  const asked = CONTEXT_TRIGGER.exec(request)?.[1];
  if (asked) return at(Number(asked));
  const previous = sessionContext(sessionId);
  return previous === null ? at(5) : at(Math.min(100, percentOf(previous) + 1));
}

export async function reportContext(
  sessionId: string,
  request: string,
  update: Update,
): Promise<void> {
  if (!contextSize) return;
  const used = nextUsed(sessionId, request);
  recordContext(sessionId, used);
  await update({
    sessionUpdate: 'usage_update',
    used,
    size: contextSize,
    cost: { amount: 0, currency: 'USD' },
  });
}

export async function commandTurn(
  prompt: acp.ContentBlock[],
  update: Update,
  say: Say,
): Promise<acp.StopReason | null> {
  if (advertisedCommands.length > 0) {
    await update({
      sessionUpdate: 'available_commands_update',
      availableCommands: advertisedCommands.map((name) => ({
        name,
        description: `Run ${name}`,
        input: name === 'review' ? { hint: 'what to review' } : null,
      })),
    });
  }
  const command = slashCommand(prompt);
  if (!command || !advertisedCommands.includes(command.name)) return null;
  if (command.name === 'compact' && contextSize) await say(FAKE_ACP_COMPACT_REPLY);
  else await say(`command=/${command.name} args=${command.rest}`);
  return 'end_turn';
}
