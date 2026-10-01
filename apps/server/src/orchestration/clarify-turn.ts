import { POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import {
  assume,
  destructiveWork,
  heldCard,
  intakeResponse,
  rewriteRequest,
} from './checkpoint-asks.ts';
import { DESTRUCTIVE_CARD_REASON } from './checkpoint-policy.ts';
import { askCard, CheckpointTimeout, type CheckpointCard } from './checkpoint.ts';
import {
  CLARIFY_NOTE,
  clarifyCard,
  clarifyPrNote,
  clarifyQuestions,
  clarifyReply,
  requestWithAnswers,
  type ClarifyQuestion,
  type ClarifyReply,
} from './clarify-questions.ts';
import { interpretations, vagueByRule, vagueHandling } from './clarify.ts';
import { vagueFollowUpByRule } from './follow-up.ts';
import { checkCommands } from './member-prompts.ts';
import { runMember, setRunMode } from './members.ts';
import { closeReply } from './plan-only.ts';
import { FULL_AUTO_PLAN_SECONDS } from './plan-first.ts';
import { destructiveByRule } from './risk-rules.ts';
import { publish, type Session } from './session.ts';
import type { ClarifiedStart, FlowEvent } from './transitions.ts';

const MAX_ROUNDS = 2;

type Asked =
  | { type: 'asked'; questions: ClarifyQuestion[]; messageId: string | null; agent: string }
  | { type: 'none' };

async function askAgent(s: Session): Promise<Asked> {
  const request = s.input.prompt;
  s.input = { ...s.input, prompt: `${request}\n\n${CLARIFY_NOTE}` };
  const { result } = await runMember(s, {
    role: 'scout',
    reason: 'first',
    escalate: false,
    note: null,
  });
  s.input = { ...s.input, prompt: request };
  if (result.outcome === 'lease_lost') throw new LeaseLostError(s.lease);
  await setRunMode(s, s.input.mode);
  await publish(s);
  const questions = result.outcome === 'succeeded' ? clarifyQuestions(result.text) : null;
  const messageId = await closeReply(s);
  return questions ? { type: 'asked', questions, messageId, agent: result.name } : { type: 'none' };
}

function replyIsVague(reply: ClarifyReply): boolean {
  if (reply.kind !== 'own_words') return false;
  return (
    vagueByRule(reply.text, 0) ||
    vagueFollowUpByRule({
      request: reply.text,
      namedFiles: 0,
      previousReply: null,
      recentTask: false,
    })
  );
}

async function record(
  s: Session,
  round: number,
  questions: readonly ClarifyQuestion[],
  reply: ClarifyReply | null,
  messageId: string | null,
): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'clarify',
    childRunId: null,
    role: 'scout',
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: {
      round,
      level: s.input.level,
      questions,
      answered: reply !== null && reply.kind !== 'defaults',
      reply: reply?.kind ?? 'stopped',
      replyText: reply?.text ?? null,
      defaultsUsed: reply?.kind === 'defaults',
      messageId,
    },
  }).catch((error: unknown) => console.error('Could not record the clarify turn', error));
}

function defaultsText(questions: readonly ClarifyQuestion[]): string {
  return questions.map((question) => `${question.question} ${question.default}`).join('\n');
}

function repliedText(questions: readonly ClarifyQuestion[], reply: ClarifyReply): string {
  return reply.text ?? defaultsText(questions);
}

function markDestructive(s: Session): void {
  s.facts = { ...s.facts, destructive: true };
  s.risky ??= DESTRUCTIVE_CARD_REASON;
  s.flow = { ...s.flow, reviewWanted: true };
  if (s.git && !s.input.chatWorktree) s.needsCopy = true;
}

function afterAnswers(s: Session, then: ClarifiedStart): ClarifiedStart {
  return then === 'build' && destructiveWork(s) ? 'plan_first' : then;
}

async function fallback(s: Session, then: ClarifiedStart): Promise<FlowEvent> {
  if (vagueHandling(s.input.level) === 'assume') {
    const [likely] = interpretations(intakeResponse(s), s.input.userRequest, checkCommands(s));
    if (likely) await assume(s, likely);
    return { type: 'clarified', start: afterAnswers(s, then) };
  }
  return { type: 'unclear', followUp: s.input.history.length > 0 };
}

function waitsAtLevel(s: Session, card: CheckpointCard): CheckpointCard {
  if (s.input.level !== 'balanced') return card;
  return { ...card, payload: { ...card.payload, autoOption: null } };
}

export async function clarifyTurn(s: Session, then: ClarifiedStart): Promise<FlowEvent> {
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const asked = await askAgent(s);
    if (asked.type === 'none')
      return round === 1 ? fallback(s, then) : { type: 'clarified', start: afterAnswers(s, then) };
    const held = destructiveWork(s) || destructiveByRule(defaultsText(asked.questions));
    const asking = clarifyCard(asked.questions, asked.agent);
    const card = held ? heldCard(asking) : waitsAtLevel(s, asking);
    const fallbackSeconds = s.input.level === 'full-auto' && !held ? FULL_AUTO_PLAN_SECONDS : null;
    const answer = await askCard(s, card, fallbackSeconds);
    if (answer.type === 'timeout') throw new CheckpointTimeout();
    const reply =
      answer.type === 'stopped'
        ? null
        : clarifyReply(card, asked.questions, answer.optionId, answer.note);
    await record(s, round, asked.questions, reply, asked.messageId);
    if (answer.type === 'stopped') return { type: 'stopped' };
    if (!reply) return { type: 'clarified', start: null };
    if (destructiveByRule(repliedText(asked.questions, reply))) markDestructive(s);
    rewriteRequest(s, (text) => requestWithAnswers(text, asked.questions, reply));
    s.prNotes = [...(s.prNotes ?? []), clarifyPrNote(asked.questions, reply)];
    s.input = {
      ...s.input,
      previousMessageId: asked.messageId ?? s.input.previousMessageId ?? null,
    };
    if (!replyIsVague(reply)) break;
  }
  return { type: 'clarified', start: afterAnswers(s, then) };
}
