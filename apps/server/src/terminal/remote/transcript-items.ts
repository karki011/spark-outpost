import type { NativeTerminalProvider, TerminalTranscriptItem } from '@spark-outpost/contracts';
import { isRecord } from '../../agent-config/records.ts';
import { interruptText } from '../claude-transcript.ts';
import { parseLine } from '../native-transcript.ts';

const TEXT_MAX = 8_000;
const DETAIL_MAX = 300;
const DETAIL_KEYS = ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'description'];
const COMMAND_WRAPPER = /^<(command-|local-command-|bash-|system-reminder)/;

type Item = TerminalTranscriptItem;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export function inputDetail(input: unknown, max = DETAIL_MAX): string {
  if (typeof input === 'string') return clip(input.trim(), max);
  if (!isRecord(input)) return '';
  for (const key of DETAIL_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return clip(value.trim(), max);
  }
  return '';
}

function joinAssistant(items: Item[], text: string, id: string, at: string | null): void {
  const last = items.at(-1);
  if (last?.kind === 'assistant' && last.id === id) {
    last.text = clip(`${last.text}\n\n${text}`, TEXT_MAX);
    return;
  }
  items.push({ id, kind: 'assistant', text: clip(text, TEXT_MAX), tool: null, at });
}

function claudeRecord(record: Record<string, unknown>, items: Item[]): void {
  if (record.isSidechain === true || record.isMeta === true) return;
  const at = stringAt(record, 'timestamp');
  const uuid = stringAt(record, 'uuid') ?? `${items.length}`;
  const message = isRecord(record.message) ? record.message : null;
  if (!message) return;
  const content = message.content;
  if (record.type === 'user') {
    const text = typeof content === 'string' ? content.trim() : '';
    if (text && !COMMAND_WRAPPER.test(text))
      items.push({ id: uuid, kind: 'user', text: clip(text, TEXT_MAX), tool: null, at });
    else if (interruptText(message))
      items.push({ id: uuid, kind: 'interrupt', text: 'Interrupted', tool: null, at });
    return;
  }
  if (record.type !== 'assistant' || !Array.isArray(content)) return;
  const messageId = stringAt(message, 'id') ?? uuid;
  for (const block of content.filter(isRecord)) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim())
      joinAssistant(items, block.text.trim(), messageId, at);
    if (block.type === 'tool_use' && typeof block.name === 'string')
      items.push({
        id: stringAt(block, 'id') ?? `${uuid}-${items.length}`,
        kind: 'tool',
        text: inputDetail(block.input),
        tool: block.name,
        at,
      });
  }
}

function contentText(content: unknown, type: string): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .filter((part) => part.type === type && typeof part.text === 'string')
    .map((part) => (part.text as string).trim())
    .filter(Boolean)
    .join('\n\n');
}

function codexRecord(record: Record<string, unknown>, items: Item[]): void {
  const payload = isRecord(record.payload) ? record.payload : null;
  if (!payload) return;
  const at = stringAt(record, 'timestamp');
  if (record.type === 'event_msg' && payload.type === 'item_completed' && isRecord(payload.item)) {
    const item = payload.item;
    const text = item.type === 'UserMessage' ? contentText(item.content, 'text') : '';
    if (text)
      items.push({
        id: stringAt(item, 'id') ?? `${items.length}`,
        kind: 'user',
        text: clip(text, TEXT_MAX),
        tool: null,
        at,
      });
    return;
  }
  if (record.type === 'event_msg' && payload.type === 'turn_aborted') {
    items.push({
      id: `abort-${items.length}`,
      kind: 'interrupt',
      text: 'Interrupted',
      tool: null,
      at,
    });
    return;
  }
  if (record.type !== 'response_item') return;
  const id = stringAt(payload, 'id') ?? `${items.length}`;
  if (payload.type === 'message' && payload.role === 'assistant') {
    const text = contentText(payload.content, 'output_text');
    if (text) joinAssistant(items, text, id, at);
    return;
  }
  if (
    (payload.type === 'custom_tool_call' || payload.type === 'function_call') &&
    typeof payload.name === 'string'
  ) {
    const input = payload.type === 'custom_tool_call' ? payload.input : payload.arguments;
    const parsed = typeof input === 'string' ? (parseLine(input) ?? input) : input;
    items.push({ id, kind: 'tool', text: inputDetail(parsed), tool: payload.name, at });
  }
}

export function transcriptItems(
  provider: NativeTerminalProvider,
  lines: readonly string[],
): Item[] {
  const items: Item[] = [];
  const read = provider === 'claude' ? claudeRecord : codexRecord;
  for (const line of lines) {
    const record = parseLine(line);
    if (isRecord(record)) read(record, items);
  }
  return items;
}
