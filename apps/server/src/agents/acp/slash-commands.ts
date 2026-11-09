import type * as acp from '@agentclientprotocol/sdk/unstable';
import {
  AGENT_COMMAND_NAME_MAX,
  AGENT_COMMAND_TEXT_MAX,
  blockedReason,
  commandKey,
  type AgentCommand,
} from '@spark-outpost/contracts';

const COMMANDS_MAX = 200;

export const SLASH_ESCAPE_NOTE =
  'The next line is the user\'s message. It starts with "/" but it is not a command, so treat it as text.';

const clip = (text: string, max: number) => text.trim().slice(0, max);

export function agentCommands(commands: readonly acp.AvailableCommand[]): AgentCommand[] {
  const seen = new Set<string>();
  return commands.slice(0, COMMANDS_MAX).flatMap((command) => {
    const name = clip(command.name.replace(/^\//, ''), AGENT_COMMAND_NAME_MAX);
    if (!name || /\s/.test(name) || seen.has(commandKey(name))) return [];
    seen.add(commandKey(name));
    const hint = command.input && 'hint' in command.input ? command.input.hint : null;
    return [
      {
        name,
        description: clip(command.description ?? '', AGENT_COMMAND_TEXT_MAX),
        hint: hint ? clip(hint, AGENT_COMMAND_TEXT_MAX) : null,
      },
    ];
  });
}

export function allowedCommands(commands: readonly AgentCommand[]): AgentCommand[] {
  return commands.filter((command) => blockedReason(command.name) === null);
}

export type SlashPrompt =
  | { kind: 'text'; text: string; note: null }
  | { kind: 'command'; text: string; note: string }
  | { kind: 'escaped'; text: string; note: string };

function slashName(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  return trimmed.slice(1).split(/\s/, 1)[0] ?? '';
}

function escaped(text: string, note: string): SlashPrompt {
  return { kind: 'escaped', text: `${SLASH_ESCAPE_NOTE}\n\n${text}`, note };
}

function command(text: string, shown: string, agentName: string): SlashPrompt {
  return { kind: 'command', text: text.trimStart(), note: `Sent ${shown} to ${agentName}` };
}

function namesCommand(known: readonly string[], name: string): boolean {
  const typed = commandKey(name);
  return known.some((entry) => {
    const key = commandKey(entry);
    return typed === key || typed.endsWith(`:${key}`);
  });
}

export function slashPrompt(
  text: string,
  agentName: string,
  advertised: readonly string[] | null,
  firstTurnCommands: readonly string[] = [],
): SlashPrompt {
  const name = slashName(text);
  if (name === null) return { kind: 'text', text, note: null };
  const shown = `/${name}`;
  const blocked = name ? blockedReason(name) : null;
  if (blocked) return escaped(text, `Blocked ${shown} as a command (${blocked}); sent as text`);
  if (advertised === null) {
    if (name && namesCommand(firstTurnCommands, name)) return command(text, shown, agentName);
    return escaped(text, `Sent ${shown} as text; commands only run in a continued session`);
  }
  const offered = new Set(advertised.map(commandKey));
  if (!name || !offered.has(commandKey(name))) {
    return escaped(text, `Sent ${shown} as text; it isn't a command ${agentName} offered`);
  }
  return command(text, shown, agentName);
}
