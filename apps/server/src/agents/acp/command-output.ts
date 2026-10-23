import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import type { ProviderOutput } from '../../providers/provider.ts';
import { objectFields } from './object-fields.ts';

export interface CommandTracker {
  see(update: SessionUpdate): ProviderOutput[];
}

type ToolUpdate = Extract<SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>;

interface OpenCommand {
  streamed: boolean;
  started: boolean;
  text: string;
  description: string | null;
  cwd: string | null;
}

const UNNAMED = 'Command';

const FENCED = /^```[a-z]*\n([\s\S]*?)\n?```$/;
const EXIT_LINE = /^Exit code (\d{1,3})\n+/;

function commandText(title: string | null | undefined, rawInput: unknown): string {
  const shown = title?.trim() ?? '';
  if (shown !== '' && shown !== 'Terminal') return shown.replace(/^`([^`]*)`$/, '$1');
  const { command } = objectFields(rawInput);
  if (typeof command === 'string') return command.trim();
  if (Array.isArray(command)) return command.filter((part) => typeof part === 'string').join(' ');
  return '';
}

function commandDescription(rawInput: unknown): string | null {
  const { description } = objectFields(rawInput);
  if (typeof description !== 'string') return null;
  const line = description.replace(/\s+/g, ' ').trim();
  return line === '' ? null : line;
}

function commandCwd(update: ToolUpdate): string | null {
  const reported = objectFields(objectFields(update._meta).terminal_info).cwd;
  if (typeof reported === 'string') return reported;
  const { cwd } = objectFields(update.rawInput);
  return typeof cwd === 'string' ? cwd : null;
}

function metaOutput(update: ToolUpdate, key: string): string | null {
  const { data } = objectFields(objectFields(update._meta)[key]);
  return typeof data === 'string' ? data : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function exitCode(update: ToolUpdate): number | null {
  const raw = objectFields(update.rawOutput);
  return (
    wholeNumber(objectFields(objectFields(update._meta).terminal_exit).exit_code) ??
    wholeNumber(raw.exit_code) ??
    wholeNumber(raw.exitCode)
  );
}

function contentText(content: readonly ToolCallContent[] | null | undefined): string {
  const texts = (content ?? []).flatMap((item) =>
    item.type === 'content' && item.content.type === 'text' ? [item.content.text] : [],
  );
  const joined = texts.join('\n');
  return FENCED.exec(joined)?.[1] ?? joined;
}

function rawText(rawOutput: unknown): string {
  if (typeof rawOutput === 'string') return rawOutput;
  const raw = objectFields(rawOutput);
  if (typeof raw.formatted_output === 'string') return raw.formatted_output;
  return [raw.stdout, raw.stderr].filter((part) => typeof part === 'string' && part).join('\n');
}

function finalText(update: ToolUpdate): string {
  return contentText(update.content) || rawText(update.rawOutput);
}

export function createCommandTracker(live: boolean): CommandTracker {
  const open = new Map<string, OpenCommand>();

  const produced = (update: ToolUpdate, command: OpenCommand): ProviderOutput[] => {
    const id = update.toolCallId;
    const outputs: ProviderOutput[] = [];
    const delta = metaOutput(update, 'terminal_output_delta');
    const whole = metaOutput(update, 'terminal_output');
    if (delta) outputs.push({ kind: 'command_output', id, data: delta });
    if (whole !== null) outputs.push({ kind: 'command_output', id, data: whole, replace: true });
    command.streamed ||= outputs.length > 0;
    const ended = update.status === 'completed' || update.status === 'failed';
    if (!ended) return outputs;
    const final = command.streamed ? '' : finalText(update);
    const exitLine = update.status === 'failed' ? EXIT_LINE.exec(final) : null;
    const text = exitLine ? final.slice(exitLine[0].length) : final;
    if (text) outputs.push({ kind: 'command_output', id, data: text });
    const code = exitCode(update) ?? (exitLine ? Number(exitLine[1]) : null);
    const failed = update.status === 'failed' || (code !== null && code !== 0);
    outputs.push({ kind: 'command_finished', id, failed, exitCode: code });
    open.delete(id);
    return outputs;
  };

  const noteDescription = (update: ToolUpdate, command: OpenCommand): ProviderOutput[] => {
    const description = commandDescription(update.rawInput);
    if (!description || description === command.description) return [];
    command.description = description;
    if (!command.started) return [];
    return [{ kind: 'command_described', id: update.toolCallId, description }];
  };

  const seen = (update: ToolUpdate, command: OpenCommand): ProviderOutput[] => {
    command.text ||= commandText(update.title, update.rawInput);
    const described = noteDescription(update, command);
    command.cwd ??= commandCwd(update);
    const outputs = [...described, ...produced(update, command)];
    if (command.started || (command.text === '' && outputs.length === 0)) return outputs;
    command.started = true;
    const { text, description, cwd } = command;
    const id = update.toolCallId;
    const titled = description ? { description } : {};
    return [
      { kind: 'command_started', id, command: text || UNNAMED, ...titled, cwd, live },
      ...outputs,
    ];
  };

  return {
    see(update) {
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
        return [];
      }
      const known = open.get(update.toolCallId);
      if (known) return seen(update, known);
      if (update.sessionUpdate !== 'tool_call' || update.kind !== 'execute') return [];
      const command: OpenCommand = {
        streamed: false,
        started: false,
        text: '',
        description: null,
        cwd: null,
      };
      open.set(update.toolCallId, command);
      return seen(update, command);
    },
  };
}
