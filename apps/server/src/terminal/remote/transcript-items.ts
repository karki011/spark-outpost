import type { NativeTerminalProvider, TerminalTranscriptItem } from '@spark-outpost/contracts';
import { isRecord } from '../../agent-config/records.ts';

const TEXT_MAX = 8_000;
const DETAIL_MAX = 300;
const INTERRUPTS = ['[Request interrupted by user]', '[Request interrupted by user for tool use]'];
const COMMAND_WRAPPER = /^<(command-|local-command-|bash-|system-reminder)/;

type Item = TerminalTranscriptItem;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function toolDetail(input: unknown): string {
  if (typeof input === 'string') return clip(input, DETAIL_MAX);
  if (!isRecord(input)) return '';
  for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return clip(value, DETAIL_MAX);
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
    if (typeof content === 'string') {
      const text = content.trim();
      if (text && !COMMAND_WRAPPER.test(text))
        items.push({ id: uuid, kind: 'user', text: clip(text, TEXT_MAX), tool: null, at });
      return;
    }
    if (!Array.isArray(content)) return;
    for (const block of content.filter(isRecord)) {
      if (
        block.type === 'text' &&
        typeof block.text === 'string' &&
        INTERRUPTS.includes(block.text)
      )
        items.push({ id: uuid, kind: 'interrupt', text: 'Interrupted', tool: null, at });
    }
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
        text: toolDetail(block.input),
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
    if (item.type !== 'UserMessage') return;
    const text = contentText(item.content, 'text');
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
    items.push({ id, kind: 'tool', text: toolDetail(parsedInput(input)), tool: payload.name, at });
  }
}

function parsedInput(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

export function transcriptItems(
  provider: NativeTerminalProvider,
  lines: readonly string[],
): Item[] {
  const items: Item[] = [];
  const read = provider === 'claude' ? claudeRecord : codexRecord;
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(record)) read(record, items);
  }
  return items;
}
