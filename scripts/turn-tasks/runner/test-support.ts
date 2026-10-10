import type { Approval } from '../../../packages/contracts/src/index.ts';
import type { Db } from '../../../apps/server/src/persistence/db.ts';
import type { Chat, ChatSetup, TurnDriver } from './driver.ts';
import type { Provider } from './providers.ts';

export interface StubScript {
  polls?: number;
  cards?: Approval[];
  work?: (repo: string) => Promise<void>;
  failSend?: string;
  failClose?: string;
}

export interface StubDriver extends TurnDriver {
  sent: { chat: Chat; text: string }[];
  opened: { repo: string; setup: ChatSetup }[];
  decided: { approvalId: string; optionId: string }[];
  cancelled: string[];
  closed: boolean;
}

export function approvalCard(overrides: Partial<Approval> = {}): Approval {
  return {
    id: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    toolCallId: 'call-1',
    kind: 'execute',
    title: 'npm test',
    payload: { command: 'npm test', cwd: null, paths: [], diffs: [], truncated: false },
    payloadHash: 'hash',
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

export function stubDriver(script: StubScript = {}, provider: Provider = 'claude'): StubDriver {
  let polls = 0;
  let cards = [...(script.cards ?? [])];
  const driver: StubDriver = {
    provider,
    db: null as unknown as Db,
    sent: [],
    opened: [],
    decided: [],
    cancelled: [],
    closed: false,
    setupFor: (mode) => ({ model: 'stub-model', effort: 'high', agentMode: mode }),
    async openChat(repo, setup) {
      driver.opened.push({ repo, setup });
      return { conversationId: `chat-${driver.opened.length}`, repo };
    },
    async send(chat, text) {
      if (script.failSend) throw new Error(script.failSend);
      polls = 0;
      cards = [...(script.cards ?? [])];
      driver.sent.push({ chat, text });
      await script.work?.(chat.repo);
      return `run-${driver.sent.length}`;
    },
    async finished() {
      polls += 1;
      return polls > (script.polls ?? 1);
    },
    async pending() {
      const waiting = cards;
      cards = [];
      return waiting;
    },
    async decide(approval, optionId) {
      driver.decided.push({ approvalId: approval.id, optionId });
    },
    async cancel(runId) {
      driver.cancelled.push(runId);
    },
    async close() {
      driver.closed = true;
      if (script.failClose) throw new Error(script.failClose);
    },
  };
  return driver;
}
