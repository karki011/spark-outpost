import path from 'node:path';
import type { ProtocolDirection } from '@spark-outpost/contracts';
import { redactText, secretKinds } from '../audit/redact.ts';
import type { Observation } from '../persistence/observations.ts';
import type { ProtocolObserver } from '../providers/provider.ts';

type Fields = Record<string, unknown>;

const MAX_SCAN_CHARS = 512 * 1024;
const MAX_DEPTH = 6;
const MAX_NAME = 60;
const READ_FILE = 'fs/read_text_file';

function fields(value: unknown): Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : {};
}

function strings(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return [];
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.flatMap((child) => strings(child, depth + 1));
}

function contentTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    const entry = fields(item);
    return entry.type === 'content' ? strings(fields(entry.content).text) : [];
  });
}

function capped(texts: readonly string[]): string {
  return texts.join('\n').slice(0, MAX_SCAN_CHARS);
}

function toolName(title: string | undefined): string {
  const clean = redactText(title ?? '')
    .replace(/\s+/g, ' ')
    .replace(/`/g, '')
    .trim();
  if (clean === '') return 'a tool';
  return `\`${clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME)}…` : clean}\``;
}

function createOutputScan(
  secretValues: readonly string[],
  record: (observation: Observation) => void,
): Pick<ProtocolObserver, 'message'> {
  const titles = new Map<string, string>();
  const flagged = new Set<string>();
  const reads = new Map<string, string>();

  const holdsSecrets = (text: string) =>
    text !== '' &&
    (secretValues.some((value) => text.includes(value)) || secretKinds(text).length > 0);

  const toolUpdate = (update: Fields) => {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : null;
    if (!id) return;
    if (typeof update.title === 'string' && update.title.trim()) titles.set(id, update.title);
    if (flagged.has(id)) return;
    const text = capped([...contentTexts(update.content), ...strings(update.rawOutput)]);
    if (!holdsSecrets(text)) return;
    flagged.add(id);
    record({
      source: 'secret_output',
      label: `secret values in the output of ${toolName(titles.get(id))}`,
    });
  };

  const readReply = (message: Fields) => {
    const id = message.id === undefined ? null : String(message.id);
    const target = id === null ? undefined : reads.get(id);
    if (id === null || target === undefined) return;
    reads.delete(id);
    if (!holdsSecrets(capped(strings(fields(message.result).content)))) return;
    record({ source: 'secret_output', label: `secret values in ${path.basename(target)}` });
  };

  return {
    message(direction: ProtocolDirection, raw: unknown) {
      const message = fields(raw);
      if (direction === 'to_agent') return readReply(message);
      if (direction !== 'from_agent') return;
      if (message.method === READ_FILE && message.id !== undefined) {
        const target = fields(message.params).path;
        if (typeof target === 'string') reads.set(String(message.id), target);
        return;
      }
      if (message.method !== 'session/update') return;
      const update = fields(fields(message.params).update);
      const kind = update.sessionUpdate;
      if (kind === 'tool_call' || kind === 'tool_call_update') toolUpdate(update);
    },
  };
}

export function scannedObserver(
  audit: ProtocolObserver,
  secretValues: readonly string[],
  record: (observation: Observation) => void,
): ProtocolObserver {
  const scan = createOutputScan(secretValues, record);
  return {
    message(direction, message) {
      try {
        scan.message(direction, message);
      } catch (error) {
        console.error('Could not scan tool output', error);
      }
      audit.message(direction, message);
    },
    stderr: (chunk) => audit.stderr(chunk),
  };
}
