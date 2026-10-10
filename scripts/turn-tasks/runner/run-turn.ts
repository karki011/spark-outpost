import { answerCard, type CardPolicy } from './cards.ts';
import type { Chat, TurnDriver } from './driver.ts';
import { TITLE_LIMIT } from './trace.ts';

export interface TurnHooks {
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  eachPoll?: (state: TurnState) => Promise<void>;
}

export interface TurnState {
  runId: string;
  elapsedMs: number;
}

export interface AnsweredCard {
  kind: string;
  allowed: boolean;
  why: string;
  title?: string;
  asked?: string | null;
}

export interface TurnOutcome {
  runId: string;
  wallMs: number;
  answered: AnsweredCard[];
}

const POLL_MS = 500;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function runTurn(
  driver: TurnDriver,
  chat: Chat,
  prompt: string,
  policy: CardPolicy,
  hooks: TurnHooks = {},
): Promise<TurnOutcome> {
  const now = hooks.now ?? Date.now;
  const sleep = hooks.sleep ?? wait;
  const started = now();
  const runId = await driver.send(chat, prompt);
  const answered: AnsweredCard[] = [];
  while (!(await driver.finished(runId))) {
    for (const approval of await driver.pending(chat)) {
      const answer = answerCard(approval, policy, chat.repo);
      await driver.decide(approval, answer.optionId);
      answered.push({
        kind: approval.kind,
        allowed: answer.allowed,
        why: answer.why,
        title: approval.title.slice(0, TITLE_LIMIT),
        asked: approval.reason ?? approval.payload.asksBecause ?? null,
      });
    }
    await hooks.eachPoll?.({ runId, elapsedMs: now() - started });
    await sleep(hooks.pollMs ?? POLL_MS);
  }
  return { runId, wallMs: now() - started, answered };
}
