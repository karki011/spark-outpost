import { blockedReason, commandKey, type AgentCommand } from '@spark-outpost/contracts';

export type ClientCommandName = 'fresh' | 'model' | 'effort' | 'plan' | 'review';

export interface SlashItem {
  name: string;
  description: string;
  hint: string | null;
  detail: string;
  source: 'client' | 'agent';
}

export interface SlashContext {
  agentName: string;
  effortHint?: string | null;
  hidden?: ReadonlySet<ClientCommandName>;
}

type ClientItem = Omit<SlashItem, 'source'> & { name: ClientCommandName };

function clientCommands(context: SlashContext): ClientItem[] {
  return [
    {
      name: 'fresh',
      description: 'Start a new agent session for this chat (drops the resumed context)',
      hint: null,
      detail: `The next message opens a new ${context.agentName} session and resends the chat history.`,
    },
    {
      name: 'model',
      description: 'Switch the model for this chat',
      hint: 'model',
      detail: 'Example: /model sonnet. Without a name, opens the model picker.',
    },
    {
      name: 'effort',
      description: 'Set how hard the agent thinks',
      hint: context.effortHint || 'level',
      detail: 'Example: /effort high. Without a level, opens the effort picker.',
    },
    {
      name: 'plan',
      description: 'Ask for a plan first, before anything changes',
      hint: 'what to plan',
      detail:
        'Example: /plan add a dark mode toggle. Sends a message asking for a plan and to wait for your go-ahead.',
    },
    {
      name: 'review',
      description: 'Ask for a review of the changes',
      hint: 'what to review',
      detail:
        'Example: /review the parser changes. In Do, a Critic reviews the changes as they land.',
    },
  ];
}

const CLIENT_NAMES = new Set<string>(['fresh', 'model', 'effort', 'plan', 'review']);

export function effortHint(efforts: readonly { id: string }[]): string | null {
  const ids = efforts.map((effort) => effort.id).filter((id) => id !== 'default');
  return ids.length > 0 ? ids.join('|') : null;
}

function agentItem(command: AgentCommand, agentName: string): SlashItem {
  const runs = `Runs in ${agentName}'s session, and only when this chat continues it.`;
  return {
    name: command.name,
    description: command.description || `No description from ${agentName}`,
    hint: command.hint,
    detail: command.hint ? `Usage: /${command.name} <${command.hint}>. ${runs}` : runs,
    source: 'agent',
  };
}

export interface SlashQuery {
  query: string;
  end: number;
}

export function findSlashQuery(draft: string, caret: number): SlashQuery | null {
  const match = /^\/(\S*)/.exec(draft);
  if (!match || caret > match[0].length) return null;
  return { query: match[1] ?? '', end: match[0].length };
}

export function slashItems(agent: readonly AgentCommand[], context: SlashContext): SlashItem[] {
  const hidden = context.hidden ?? new Set();
  const client = clientCommands(context)
    .filter((command) => !hidden.has(command.name))
    .map((command): SlashItem => ({ ...command, source: 'client' }));
  const agentItems = agent
    .filter((command) => !CLIENT_NAMES.has(commandKey(command.name)))
    .filter((command) => blockedReason(command.name) === null)
    .map((command) => agentItem(command, context.agentName));
  return [...client, ...agentItems];
}

export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  const starts = items.filter((item) => item.name.toLowerCase().startsWith(needle));
  const contains = items.filter(
    (item) =>
      !starts.includes(item) &&
      (item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)),
  );
  return [...starts, ...contains];
}

export interface ParsedSlash {
  name: string;
  args: string;
}

export function parseSlash(text: string): ParsedSlash | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1]!, args: (match[2] ?? '').trim() };
}

export function clientCommand(parsed: ParsedSlash | null): ClientCommandName | null {
  const key = parsed ? commandKey(parsed.name) : null;
  return key && CLIENT_NAMES.has(key) ? (key as ClientCommandName) : null;
}

export function blockedMessage(parsed: ParsedSlash | null): string | null {
  if (!parsed) return null;
  const reason = blockedReason(parsed.name);
  return reason ? `/${parsed.name} is blocked: ${reason}.` : null;
}

export function typedCommandNote(
  parsed: ParsedSlash | null,
  items: readonly SlashItem[],
  agentName: string,
): string | null {
  if (!parsed) return null;
  const key = commandKey(parsed.name);
  if (CLIENT_NAMES.has(key) || items.some((item) => item.name.toLowerCase() === key)) return null;
  const blocked = blockedMessage(parsed);
  if (blocked) return blocked;
  return `/${parsed.name} isn't a Spark or ${agentName} command, so it's sent as text.`;
}

export function planPrompt(args: string): string {
  return `Make a plan first, and wait for my go-ahead before changing anything.\n\n${args}`;
}

export function reviewPrompt(args: string): string {
  return args
    ? `Review ${args} and give me a second opinion.`
    : 'Review the changes in this chat and give me a second opinion.';
}
