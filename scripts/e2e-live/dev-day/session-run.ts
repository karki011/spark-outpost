import { join } from 'node:path';
import type { DiffStat } from '../../bench/verify.ts';
import type { BaseArm } from '../scenario-types.ts';
import type { Runtime } from '../stack.ts';
import type { ArmDay, ArmSessionResult, PreparedTurn } from './arm.ts';
import { NO_HARNESS_EVIDENCE } from './arm.ts';
import type { GitHubStub } from './github-stub.ts';
import { hiddenCounts, suiteCounts } from './hidden.ts';
import { DIRECT_LEVEL_LABEL, LEVELS } from './levels.ts';
import { anchorFor, pickPassage, quotedMessage } from './quotes.ts';
import {
  applyPatch,
  changedFiles,
  createRepo,
  diffStat,
  fingerprint,
  git,
  remoteBranches,
  settle,
  snapshot,
  type DayRepo,
} from './repos.ts';
import type { DayOptions } from './run-day.ts';
import { scoreSession, type Evidence, type Intervention, type SessionScore } from './score.ts';
import type { DaySession, RepoKey } from './session-types.ts';

const CAP_FACTOR = 3;
const MIN_CAP_USD = 0.5;

export interface DayTurnRecord {
  prompt: string;
  runId: string;
  status: string;
  error: string | null;
  wallMs: number;
  costUsd: number;
  crew: string[];
  interrupted: boolean;
  reply: string;
}

export interface DayRecord {
  session: string;
  title: string;
  arm: BaseArm;
  level: string;
  startedAt: string;
  wallMs: number;
  costUsd: number;
  capUsd: number;
  overCap: boolean;
  turns: DayTurnRecord[];
  evidence: Evidence;
  score: SessionScore;
  diff: DiffStat;
  shots: string[];
  conversation: string | null;
}

export interface ArmState {
  day: ArmDay;
  repos: Map<RepoKey, DayRepo>;
  replies: Map<string, { reply: string; messageId: string | null }>;
}

export function sessionCap(session: DaySession, arm: BaseArm): number {
  return Math.max(MIN_CAP_USD, session.expectUsd[arm] * CAP_FACTOR);
}

function prepareTurns(
  session: DaySession,
  arm: BaseArm,
  state: ArmState,
  runtime: Runtime,
): { turns: PreparedTurn[]; interventions: Intervention[] } {
  const interventions: Intervention[] = [];
  const turns = session.turns.map((turn, index): PreparedTurn => {
    let text = turn.text;
    let quote: PreparedTurn['quote'] = null;
    if (turn.quote) {
      const source = state.replies.get(turn.quote.fromSession);
      const reply = source?.reply ?? '';
      const passage = pickPassage(reply, turn.quote.pick);
      quote = { passage, messageId: source?.messageId ?? null, anchor: anchorFor(reply, passage) };
      text = quotedMessage(passage, turn.text);
    }
    if (index === 0 && arm !== 'harness' && session.pastePlanFrom) {
      const plan = state.replies.get(session.pastePlanFrom)?.reply ?? '';
      text = `${text}\n\nHere is the plan we agreed on:\n\n${plan}`;
      interventions.push({ kind: 'paste', text: `pasted the plan from ${session.pastePlanFrom}` });
    }
    if (runtime === 'fake') text = `${text}${turn.fakeTags}`;
    const interrupt = turn.interruptAfterMs
      ? runtime === 'fake'
        ? turn.interruptAfterMs.fake
        : turn.interruptAfterMs.live
      : null;
    return { text, quote, interruptAfterMs: interrupt };
  });
  return { turns, interventions };
}

export function failed(error: string): ArmSessionResult {
  return {
    ...NO_HARNESS_EVIDENCE,
    logs: [],
    reply: '',
    replyMessageId: null,
    reviewText: '',
    timedOut: false,
    error,
    cappedAtUsd: null,
    interventions: [],
    conversation: null,
  };
}

export function shipEvidence(
  session: DaySession,
  repo: DayRepo,
  stub: GitHubStub,
  pullsBefore: number,
): Pick<Evidence, 'draftPr' | 'pushedBranches'> {
  if (!session.ship || !repo.remote) return { draftPr: null, pushedBranches: [] };
  const branches = remoteBranches(repo.remote).filter((branch) => branch !== 'main');
  const pull = stub.pulls.slice(pullsBefore).at(-1);
  return {
    draftPr: pull
      ? { opened: true, draft: pull.draft, branchPushed: branches.includes(pull.head) }
      : { opened: false, draft: false, branchPushed: false },
    pushedBranches: branches,
  };
}

function directShipInterventions(evidence: Pick<Evidence, 'pushedBranches'>): Intervention[] {
  const list: Intervention[] = [];
  if (evidence.pushedBranches.length === 0) {
    list.push({ kind: 'manual-push', text: 'pushed the branch by hand' });
  }
  list.push({ kind: 'manual-pr', text: 'opened the draft PR by hand' });
  return list;
}

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

export async function runSession(
  options: Pick<DayOptions, 'dir' | 'runtime' | 'rates'>,
  session: DaySession,
  state: ArmState,
  stub: GitHubStub,
): Promise<DayRecord> {
  const arm = state.day.arm;
  let repo = state.repos.get(session.repo);
  if (!repo) {
    repo = await createRepo(session.repo, options.dir, `${arm}-${session.repo}`);
    state.repos.set(session.repo, repo);
  }
  const base = git(repo.path, 'rev-parse', 'HEAD').trim();
  if (session.plantBefore) await applyPatch(repo.path, session.plantBefore);
  const before = snapshot(repo.path);
  const prepared = prepareTurns(session, arm, state, options.runtime);
  const capUsd = sessionCap(session, arm);
  const pullsBefore = stub.pulls.length;
  const startedAt = new Date().toISOString();
  const result = await state.day
    .run(session, repo, prepared.turns, capUsd)
    .catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)));
  const changed = changedFiles(repo.path, before);
  const scratch = join(options.dir, 'scratch');
  const hidden = session.expect.hidden
    ? await hiddenCounts(session.repo, repo.path, session.expect.hidden, scratch)
    : null;
  const suite = session.expect.hidden ? await suiteCounts(session.repo, repo.path, scratch) : null;
  const ship = shipEvidence(session, repo, stub, pullsBefore);
  const interventions = [
    ...prepared.interventions,
    ...result.interventions,
    ...(session.ship && arm !== 'harness' ? directShipInterventions(ship) : []),
  ];
  const evidence: Evidence = {
    arm,
    changed,
    reply: result.reply,
    reviewText: result.reviewText,
    clarifyCard: result.clarifyCard,
    planCard: result.planCard,
    planSaved: result.planSaved,
    hidden,
    suite,
    timedOut: result.timedOut,
    error: result.error,
    originalUntouched: repo.original
      ? fingerprint(repo.original.path) === repo.original.fingerprint
      : null,
    roles: result.roles,
    checksRan: result.checksRan,
    builderPlanLoaded: result.builderPlanLoaded,
    criticPlanLoaded: result.criticPlanLoaded,
    topTier: result.topTier,
    worktrees: result.worktrees,
    cardFirst: result.cardFirst,
    builders: result.builders,
    parallelBuilders: result.parallelBuilders,
    handoff: result.handoff,
    resumed: result.resumed,
    shipAvailable: result.shipAvailable,
    interventions,
    clicks: result.clicks,
    ...ship,
  };
  const score = scoreSession(session, evidence, options.rates);
  const diff = diffStat(repo.path, base);
  await settle(repo, options.dir, base, session.reference, `Developer: ${session.id} done`);
  state.replies.set(session.id, { reply: result.reply, messageId: result.replyMessageId });
  const costUsd = result.logs.reduce((sum, log) => sum + log.metrics.costUsd, 0);
  return {
    session: session.id,
    title: session.title,
    arm,
    level: arm === 'harness' ? LEVELS[session.level].label : DIRECT_LEVEL_LABEL,
    startedAt,
    wallMs: result.logs.reduce((sum, log) => sum + log.metrics.wallMs, 0),
    costUsd,
    capUsd,
    overCap: result.cappedAtUsd !== null || costUsd > capUsd,
    turns: result.logs.map((log) => ({
      prompt: clip(log.prompt, 600),
      runId: log.metrics.runId,
      status: log.metrics.status,
      error: log.metrics.error,
      wallMs: log.metrics.wallMs,
      costUsd: log.metrics.costUsd,
      crew: log.metrics.agents.map(
        (agent) => `${agent.role} ${agent.model ?? '?'}·${agent.effort ?? '?'}`,
      ),
      interrupted: log.interrupted,
      reply: clip(log.metrics.reply, 3_000),
    })),
    evidence: {
      ...evidence,
      reply: clip(evidence.reply, 3_000),
      reviewText: clip(evidence.reviewText, 4_000),
    },
    score,
    diff,
    shots: result.shots,
    conversation: result.conversation,
  };
}
