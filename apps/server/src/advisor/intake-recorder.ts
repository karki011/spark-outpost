import {
  adviceSummarySchema,
  CATEGORY_CONFIDENCE_FLOOR,
  type AdviceBody,
  type Category,
} from '@spark-outpost/contracts';
import { insertAdvice, loadIntakeContext, type IntakeContext } from '../persistence/advice.ts';
import { recordRunCategory } from '../persistence/auto-title.ts';
import type { Db } from '../persistence/db.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { Append } from '../workflow/agent-turn.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { runEvents } from '../workflow/run-events.ts';
import { AdvisorError, AdvisorTimeoutError, type IntakeRequest } from './advice.ts';
import { adviceBody, type IntakeDecided, type JevOutcome } from './advice-body.ts';
import {
  assertCandidates,
  buildIntakeQuestions,
  parseIntakeAnswers,
  type IntakeQuestions,
} from './intake-questions.ts';
import { askSystemOne, JEV_TIMEOUT_MS, jevUsage, requestModel } from './jev.ts';

export interface IntakeDeps {
  db: Db;
  secrets: SecretStore;
  fetch: typeof fetch;
  baseUrl: string;
  timeoutMs?: number;
}

export interface IntakeRecorder {
  deps: IntakeDeps;
}

const MISSING_KEY = 'The Jev key is missing from the keychain. Connect Jev again in Settings.';

function untrustedText(input: RunInput): string[] {
  return input.attachments
    .filter((attachment) => attachment.kind === 'text')
    .map((attachment) => attachment.data.toString('utf8'));
}

function failure(error: unknown): { status: 'failed' | 'timed_out'; error: string } {
  if (error instanceof AdvisorTimeoutError) return { status: 'timed_out', error: error.message };
  if (error instanceof AdvisorError) return { status: 'failed', error: error.message };
  return { status: 'failed', error: 'Jev failed unexpectedly.' };
}

export async function askJev(
  deps: IntakeDeps,
  request: IntakeRequest,
  alias: string,
): Promise<JevOutcome> {
  const model = requestModel(alias);
  const apiKey = await deps.secrets.get('jev').catch(() => null);
  if (!apiKey) return { status: 'failed', error: MISSING_KEY, model, asked: null, latencyMs: null };
  let asked: IntakeQuestions | null = null;
  const startedAt = Date.now();
  try {
    assertCandidates(request);
    asked = buildIntakeQuestions(request);
    const response = await askSystemOne(
      {
        baseUrl: deps.baseUrl,
        apiKey,
        model,
        fetch: deps.fetch,
        timeoutMs: deps.timeoutMs ?? JEV_TIMEOUT_MS,
      },
      asked,
      new AbortController().signal,
    );
    const intake = parseIntakeAnswers(request, asked, response);
    return {
      status: 'answered',
      model: response.model,
      asked,
      response,
      intake,
      latencyMs: Date.now() - startedAt,
      usage: jevUsage(asked, response),
    };
  } catch (error) {
    return { ...failure(error), model, asked, latencyMs: Date.now() - startedAt };
  }
}

async function announce(append: Append, body: AdviceBody): Promise<void> {
  try {
    await append(runEvents.activity('artifact:advice', 'advice', adviceSummarySchema.parse(body)));
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

export interface IntakeExtra {
  firstMessage: boolean;
  currentTask: IntakeRequest['currentTask'];
  fourWay?: boolean;
}

export function previousReply(input: RunInput): string | null {
  const last = input.history.at(-1);
  return last?.role === 'assistant' && last.content.trim() ? last.content : null;
}

export function intakeRequest(
  input: RunInput,
  context: IntakeContext,
  extra: IntakeExtra = { firstMessage: input.history.length === 0, currentTask: null },
): IntakeRequest {
  return {
    task: input.prompt,
    mode: input.mode ?? 'chat',
    reposLinked: input.projectRoots.length > 0,
    untrusted: untrustedText(input),
    candidates: context.candidates,
    current: {
      provider: input.provider,
      model: input.settings.model,
      modelLabel: input.settings.modelLabel,
      effort: input.settings.effort,
    },
    level: input.level,
    routing: context.routing,
    firstMessage: extra.firstMessage,
    currentTask: extra.currentTask,
    previousReply: previousReply(input),
    ...(extra.fourWay ? { fourWay: true } : {}),
  };
}

export function turnCategory(outcome: JevOutcome, rules: Category | null = null): Category | null {
  if (outcome.status !== 'answered') return rules;
  const confidence = outcome.intake.confidences.intent ?? outcome.intake.confidence;
  if (confidence < CATEGORY_CONFIDENCE_FLOOR) return rules;
  return outcome.intake.intent ?? rules;
}

export interface IntakeResult {
  body: AdviceBody;
  context: IntakeContext;
  outcome: JevOutcome;
}

export interface AskedIntake {
  request: IntakeRequest;
  context: IntakeContext;
  outcome: JevOutcome;
}

async function jevOutcome(
  deps: IntakeDeps | null,
  request: IntakeRequest,
  context: IntakeContext,
  skipReason: string | null,
): Promise<JevOutcome> {
  if (!deps || !context.jevModel) return { status: 'not_connected' };
  if (skipReason) return { status: 'not_asked', reason: skipReason };
  return askJev(deps, request, context.jevModel);
}

export async function askIntake(
  db: Db,
  deps: IntakeDeps | null,
  input: RunInput,
  extra: IntakeExtra,
  skipReason: string | null = null,
): Promise<AskedIntake> {
  const context = await loadIntakeContext(db, input.workspaceId, input.identity.threadId);
  const request = intakeRequest(input, context, extra);
  return { request, context, outcome: await jevOutcome(deps, request, context, skipReason) };
}

export async function saveIntake(
  db: Db,
  input: RunInput,
  append: Append,
  asked: AskedIntake,
  decided: IntakeDecided,
): Promise<IntakeResult> {
  const body = adviceBody(asked.request, asked.outcome, decided);
  await insertAdvice(db, input.identity.runId, body);
  await recordRunCategory(
    db,
    input.identity.runId,
    turnCategory(asked.outcome, decided.rules.intent),
  );
  if (asked.outcome.status !== 'not_connected') await announce(append, body);
  return { body, context: asked.context, outcome: asked.outcome };
}

export function createIntakeRecorder(deps: IntakeDeps): IntakeRecorder {
  return { deps };
}
