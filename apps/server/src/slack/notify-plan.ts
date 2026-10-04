import {
  escapeSlackText,
  sparkChatLink,
  type SlackNotifyEvent,
  type SlackSettings,
} from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';

export interface NotifyCandidate {
  key: string;
  event: SlackNotifyEvent;
  detail: string | null;
  url: string | null;
}

export type NotifyDecision = 'send' | 'off' | 'focused' | 'no_target';

export interface NotifyFacts {
  settings: SlackSettings;
  focused: boolean;
  target: string | null;
}

export function notifyDecision(candidate: NotifyCandidate, facts: NotifyFacts): NotifyDecision {
  if (!facts.settings.notify[candidate.event]) return 'off';
  if (facts.target === null) return 'no_target';
  if (facts.focused && facts.settings.quietWhenFocused) return 'focused';
  return 'send';
}

export function notifyTarget(memberId: string | null, settings: SlackSettings): string | null {
  return settings.notifyChannelId ?? memberId;
}

const PLAN_KINDS = new Set(['plan', 'pieces']);
const QUESTION_KINDS = new Set([
  'clarify',
  'retry',
  'budget',
  'merge_conflict',
  'stuck',
  'verify',
  'ownership',
  'pr_split',
  'compact',
]);

const SAFE_PR_URL = /^https:\/\/[A-Za-z0-9.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

export function notifyLine(candidate: NotifyCandidate): string {
  if (candidate.event === 'finished') return 'Finished';
  if (candidate.event === 'failed') return 'Failed';
  if (candidate.event === 'flag') return 'Flagged an action that crossed a guardrail';
  if (candidate.event === 'pr_opened') {
    return candidate.url && SAFE_PR_URL.test(candidate.url)
      ? `Opened a pull request: ${candidate.url}`
      : 'Opened a pull request';
  }
  if (candidate.detail && PLAN_KINDS.has(candidate.detail)) return 'Has a plan for you to review';
  if (candidate.detail === 'accept') return 'Has changes for you to review';
  if (candidate.detail && QUESTION_KINDS.has(candidate.detail)) return 'Has a question for you';
  return 'Needs your approval';
}

function counted(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts].map(([line, count]) => (count > 1 ? `${line} (${count})` : line));
}

const TITLE_MAX = 80;

export interface NotifyChat {
  conversationId: string;
  title: string;
  project: string | null;
}

export function notificationText(
  chat: NotifyChat,
  candidates: readonly NotifyCandidate[],
  linkScheme?: string,
): string {
  const title = escapeSlackText(redactText(chat.title).slice(0, TITLE_MAX)) || 'Untitled chat';
  const project = chat.project ? ` · ${escapeSlackText(chat.project.slice(0, TITLE_MAX))}` : '';
  const link = sparkChatLink(chat.conversationId, linkScheme);
  return [
    `*${title}*${project}`,
    ...counted(candidates.map(notifyLine)).map((line) => `• ${line}`),
    `<${link}|Open in Spark> (${link})`,
  ].join('\n');
}

export function threadUpdateText(candidate: NotifyCandidate): string | null {
  if (candidate.event === 'finished') return 'Spark finished this work.';
  if (candidate.event === 'failed') return 'Spark stopped on this work with an error.';
  if (candidate.event === 'pr_opened')
    return `Spark ${notifyLine(candidate).replace('Opened', 'opened')}`;
  return null;
}

interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: Timers = {
  set: (run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref();
    return timer;
  },
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class NotifyBatcher<Item> {
  private readonly waiting = new Map<string, { items: Item[]; timer: unknown }>();

  constructor(
    private readonly batchMs: number,
    private readonly flush: (key: string, items: Item[]) => void,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  add(key: string, item: Item): void {
    const batch = this.waiting.get(key);
    if (batch) {
      batch.items.push(item);
      return;
    }
    const timer = this.timers.set(() => this.release(key), this.batchMs);
    this.waiting.set(key, { items: [item], timer });
  }

  release(key: string): void {
    const batch = this.waiting.get(key);
    if (!batch) return;
    this.timers.clear(batch.timer);
    this.waiting.delete(key);
    this.flush(key, batch.items);
  }

  releaseAll(): void {
    for (const key of [...this.waiting.keys()]) this.release(key);
  }
}
