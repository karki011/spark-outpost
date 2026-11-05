import { digestModelFor } from '../../digest/service.ts';
import type { Db } from '../../persistence/db.ts';
import type { Lease } from '../../persistence/jobs.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { getSetupState } from '../../persistence/setup.ts';
import type { Provider, ProviderOutput } from '../../providers/provider.ts';
import type { TurnDeps, TurnResult } from '../../workflow/agent-turn.ts';
import { finishRun } from '../../workflow/execute-run.ts';
import { runAppender } from '../../workflow/run-appender.ts';
import { startControl } from '../../workflow/run-control.ts';
import { runEvents } from '../../workflow/run-events.ts';
import { loadRunInput, type RunInput } from '../../workflow/run-input.ts';
import { recordTokens, spendRecorder } from '../../workflow/run-metadata.ts';
import { buildReviewPrompt } from './review-prompt.ts';
import { needsReview, parseReviewReply } from './review-result.ts';
import {
  finishPluginReview,
  loadPluginReviews,
  reviewKey,
  startPluginReview,
  type ReviewModel,
} from './review-store.ts';
import type { ScannedPlugin } from './scan.ts';

export const MALFORMED_REVIEW = 'The agent review did not return findings Spark could read.';
const USED_TOOLS = 'The agent review tried to use a tool, so its answer was not used.';

const REVIEW_PROVIDER = 'claude';

export async function claudeReviewModel(db: Db, workspaceId: string): Promise<ReviewModel | null> {
  const setup = await getSetupState(db, workspaceId);
  const claude = setup.providers.find((provider) => provider.id === REVIEW_PROVIDER);
  if (!claude?.connection) return null;
  const chosen = await digestModelFor(db, workspaceId, REVIEW_PROVIDER);
  return { provider: REVIEW_PROVIDER, model: chosen.model, effort: chosen.effort };
}

function reviewRequest(plugin: ScannedPlugin) {
  return {
    pluginKey: plugin.installed.key,
    fingerprint: plugin.fingerprint,
    prompt: buildReviewPrompt(plugin).prompt,
  };
}

export async function requestPluginReviews(
  db: Db,
  workspaceId: string,
  plugins: readonly ScannedPlugin[],
): Promise<void> {
  const reviews = await loadPluginReviews(db, workspaceId);
  const unreviewed = plugins.filter(
    (plugin) =>
      plugin.unloadableReason === null &&
      needsReview(reviews.get(reviewKey(plugin.installed.key, plugin.fingerprint)), false),
  );
  if (unreviewed.length === 0) return;
  const model = await claudeReviewModel(db, workspaceId);
  if (!model) return;
  for (const plugin of unreviewed) {
    await startPluginReview(db, workspaceId, reviewRequest(plugin), model).catch((error: unknown) =>
      console.error(`Could not start the agent review of ${plugin.installed.key}`, error),
    );
  }
}

export async function reviewPluginAgain(
  db: Db,
  workspaceId: string,
  plugin: ScannedPlugin,
  model: ReviewModel,
): Promise<boolean> {
  return startPluginReview(db, workspaceId, reviewRequest(plugin), model, true);
}

export interface ReviewReply {
  text: string;
  tools: string[];
}

function toolName(output: ProviderOutput): string | null {
  if (output.kind === 'tool_started') return output.name;
  if (output.kind === 'command_started') return output.command;
  if (output.kind === 'step_started' && output.tool) return output.name;
  return null;
}

export async function askReviewModel(
  provider: Provider,
  input: Pick<RunInput, 'prompt' | 'settings'>,
  signal: AbortSignal,
  onUsage: (output: ProviderOutput) => Promise<void> = async () => undefined,
): Promise<ReviewReply> {
  let text = '';
  const tools: string[] = [];
  for await (const output of provider.run({
    prompt: input.prompt,
    history: [],
    settings: input.settings,
    signal,
    mode: 'chat',
  })) {
    if (output.kind === 'text_delta') text += output.delta;
    const tool = toolName(output);
    if (tool) tools.push(tool);
    await onUsage(output);
  }
  return { text, tools };
}

function usageRecorder(db: Db, runId: string, provider: string) {
  const recordSpend = spendRecorder(db, runId, provider, null);
  return async (output: ProviderOutput) => {
    if (output.kind === 'tokens') await recordTokens(db, runId, output);
    if (output.kind === 'usage') await recordSpend(output);
  };
}

function failure(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return 'The agent review was stopped.';
  return error instanceof Error && error.message ? error.message : 'The agent review failed.';
}

async function reviewOutcome(deps: TurnDeps, lease: Lease, input: RunInput, signal: AbortSignal) {
  const provider = deps.providers.get(input.provider);
  if (!provider) return { error: `${input.provider} isn't available for the agent review.` };
  try {
    const reply = await askReviewModel(
      provider,
      input,
      signal,
      usageRecorder(deps.db, lease.runId, input.provider),
    );
    if (reply.tools.length > 0) return { error: USED_TOOLS };
    const findings = parseReviewReply(reply.text);
    return findings ? { findings } : { error: MALFORMED_REVIEW };
  } catch (error) {
    return { error: failure(error, signal) };
  }
}

export async function executePluginReview(deps: TurnDeps, lease: Lease): Promise<void> {
  const input = await loadRunInput(deps.db, lease.runId);
  const append = runAppender(deps.db, lease);
  const control = startControl(deps, lease);
  try {
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    const outcome = await reviewOutcome(deps, lease, input, control.signal);
    if (control.reason() === 'lease_lost') return;
    await finishPluginReview(deps.db, lease.runId, outcome);
    const result: TurnResult =
      'findings' in outcome
        ? { outcome: 'succeeded', error: null, text: '', messageId: null }
        : { outcome: 'failed', error: outcome.error, text: '', messageId: null };
    await finishRun(append, input.identity, result, false);
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  } finally {
    control.dispose();
  }
}
