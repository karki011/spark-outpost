import { terminalLabel, type NativeTerminalSession } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import { notifyLine } from '../slack/notify-plan.ts';

export interface PushCandidate {
  key: string;
  source: string;
  kind: 'approval' | 'terminal';
  detail: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  chatId: string;
  tag: string;
}

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}

const TERMINAL_WAITING = new Set<NativeTerminalSession['state']>([
  'waiting_for_permission',
  'waiting_for_input',
]);

function candidateLine(candidate: PushCandidate): string {
  if (candidate.kind === 'terminal') {
    const state = candidate.detail as NativeTerminalSession['state'];
    return TERMINAL_WAITING.has(state)
      ? `${terminalLabel(state)} in the terminal`
      : 'Needs you in the terminal';
  }
  return notifyLine({
    key: candidate.key,
    event: 'needs_you',
    detail: candidate.detail,
    url: null,
  });
}

function counted(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts].map(([line, count]) => (count > 1 ? `${line} (${count})` : line));
}

const TITLE_MAX = 80;

export function pushMessage(
  chat: { conversationId: string; title: string },
  candidates: readonly PushCandidate[],
): PushMessage {
  const title = redactText(chat.title).trim().slice(0, TITLE_MAX) || 'Untitled chat';
  return {
    title,
    body: counted(candidates.map(candidateLine)).join(' · '),
    chatId: chat.conversationId,
    tag: `spark-chat-${chat.conversationId}`,
  };
}

export function quietDevice(deviceId: string, focusedClients: readonly string[]): boolean {
  return focusedClients.includes(`device:${deviceId}`);
}

const SENT_LIMIT = 2000;

export class SentKeys {
  private readonly keys = new Set<string>();

  claim(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > SENT_LIMIT) this.keys.delete(this.keys.values().next().value!);
    return true;
  }
}

export class TerminalWaits {
  private readonly entered = new Map<string, number>();
  private readonly waiting = new Set<string>();

  key(sessionId: string, generation: number, state: string): string | null {
    const id = `${sessionId}:${generation}`;
    if (!TERMINAL_WAITING.has(state as NativeTerminalSession['state'])) {
      this.waiting.delete(id);
      return null;
    }
    if (!this.waiting.has(id)) {
      this.waiting.add(id);
      this.entered.set(id, (this.entered.get(id) ?? 0) + 1);
    }
    return `terminal:${id}:${this.entered.get(id)}`;
  }
}
