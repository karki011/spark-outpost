import {
  adviceSummarySchema,
  CATEGORY_CONFIDENCE_FLOOR,
  type AdviceBody,
  type BuildStyle,
  type Category,
  type RunEvent,
} from '@spark-outpost/contracts';
import { insertAdvice, loadIntakeContext, type IntakeContext } from '../persistence/advice.ts';
import { recordRunCategory } from '../persistence/auto-title.ts';
import type { Db } from '../persistence/db.ts';
import { LeaseLostError, type AppendOptions } from '../persistence/run-events.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { runEvents } from '../workflow/run-events.ts';
import { AdvisorError, AdvisorTimeoutError, type IntakeRequest } from './advice.ts';
import { adviceBody, type JevOutcome } from './advice-body.ts';
import {
  buildIntakeQuestions,
  parseIntakeAnswers,
  type IntakeQuestions,
} from './intake-questions.ts';
import { askSystemOne, JEV_TIMEOUT_MS, jevUsage, requestModel } from './jev.ts';

type Append = (event: RunEvent, options?: AppendOptions) => Promise<number>;

export interface IntakeDeps {
  db: Db;
  secrets: SecretStore;
  fetch: typeof fetch;
  baseUrl: string;
  timeoutMs?: number;
}

export interface IntakeRecorder {
  deps: IntakeDeps;
  start(input: RunInput, append: Append): void;
  settled(): Promise<void>;
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

export function intakeRequest(
  input: RunInput,
  context: IntakeContext,
  buildStyle?: BuildStyle,
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
    ...(buildStyle ? { buildStyle } : {}),
  };
}

export function turnCategory(outcome: JevOutcome): Category | null {
  if (outcome.status !== 'answered') return null;
  const confidence = outcome.intake.confidences.intent ?? outcome.intake.confidence;
  return confidence >= CATEGORY_CONFIDENCE_FLOOR ? outcome.intake.intent : null;
}

export interface IntakeResult {
  body: AdviceBody;
  context: IntakeContext;
  outcome: JevOutcome;
}

export async function recordIntake(
  deps: IntakeDeps,
  input: RunInput,
  append: Append,
  buildStyle?: BuildStyle,
): Promise<IntakeResult> {
  const context = await loadIntakeContext(deps.db, input.workspaceId, input.identity.threadId);
  const request = intakeRequest(input, context, buildStyle);
  const outcome = context.jevModel
    ? await askJev(deps, request, context.jevModel)
    : ({ status: 'not_connected' } as const);
  const body = adviceBody(request, outcome);
  await insertAdvice(deps.db, input.identity.runId, body);
  await recordRunCategory(deps.db, input.identity.runId, turnCategory(outcome));
  if (outcome.status !== 'not_connected') await announce(append, body);
  return { body, context, outcome };
}

export function createIntakeRecorder(deps: IntakeDeps): IntakeRecorder {
  const pending = new Set<Promise<void>>();
  return {
    deps,
    start(input, append) {
      const work = recordIntake(deps, input, append)
        .then(() => undefined)
        .catch((error: unknown) => console.error('Could not record Jev intake', error))
        .finally(() => pending.delete(work));
      pending.add(work);
    },
    async settled() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
