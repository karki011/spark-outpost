import { turnCategory } from '../advisor/intake-recorder.ts';
import { agreedPlanFor } from '../plans/plan-staleness.ts';
import { builtSinceApproval } from '../plans/plan-turn.ts';
import { latestApprovedPlan } from '../persistence/plan-documents.ts';
import { liveRunBase } from '../projects/run-base.ts';
import { gitDiffBetween, gitDiffSince, headCommit } from '../projects/snapshot.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import { projectMoveNote } from '../workflow/project-move.ts';
import { builderPrompt, criticPrompt, type ChangedFile } from './context.ts';
import { codeContext } from './code-context.ts';
import { pieceReviews } from '../coordinator/critic-pieces.ts';
import { lawFacts } from '../laws/review.ts';
import { removalFindings } from '../laws/removals.ts';
import { fixDiff } from './fix-rounds.ts';
import type { ChangedLines } from './checkpoint.ts';
import { asksAboutPrChecksByRule } from './risk-rules.ts';
import type { Session } from './session.ts';
import { publishBrief } from '../workflow/publish-context.ts';
import type { Spawn } from './transitions.ts';
import { deliveredToCrew, type CrewNote } from '../persistence/member-messages.ts';

export interface ChangeSummary {
  files: ChangedFile[];
  patch: string;
}

interface GitSnapshot {
  root: string;
  ref: string;
}

export async function runBase(s: Session): Promise<GitSnapshot | null> {
  const state = await getSnapshot(s.deps.db, s.input.workspaceId, s.lease.runId);
  const snapshot = state?.snapshot;
  if (!snapshot || snapshot.kind !== 'git' || !snapshot.ref) return null;
  return { root: snapshot.root, ref: await liveRunBase(snapshot.root, snapshot.ref) };
}

function originOf(
  path: string,
  ownPaths: ReadonlySet<string>,
  beforePaths: ReadonlySet<string>,
): NonNullable<ChangedFile['origin']> {
  if (!beforePaths.has(path)) return 'task';
  return ownPaths.has(path) ? 'both' : 'before';
}

export async function changesSoFar(s: Session): Promise<ChangeSummary> {
  const snapshot = await runBase(s);
  if (!snapshot) return { files: [], patch: '' };
  const diff = await gitDiffSince(snapshot.root, snapshot.ref).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : { files: [], patch: '' };
}

export async function changedLines(s: Session): Promise<ChangedLines> {
  const { files } = await changesSoFar(s).catch(() => ({ files: [] as ChangedFile[] }));
  if (files.length === 0) return null;
  return {
    added: files.reduce((sum, file) => sum + file.additions, 0),
    removed: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

export async function changesForReview(s: Session): Promise<ChangeSummary> {
  const own = await changesSoFar(s);
  const snapshot = await runBase(s);
  if (!snapshot) return own;
  const head = await headCommit(snapshot.root).catch(() => null);
  if (!head) return own;
  const [all, before] = await Promise.all([
    gitDiffSince(snapshot.root, head).catch(() => null),
    gitDiffBetween(snapshot.root, head, snapshot.ref).catch(() => null),
  ]);
  if (!all || !before || before.stats.length === 0) return own;
  const ownPaths = new Set(own.files.map((file) => file.path));
  const beforePaths = new Set(before.stats.map((file) => file.path));
  return {
    files: all.stats.map((file) => ({
      ...file,
      origin: originOf(file.path, ownPaths, beforePaths),
    })),
    patch: all.patch,
  };
}

export function checkCommands(s: Session): string[] {
  return s.checks?.commands.map((check) => check.command) ?? [];
}

export function agreedPlanText(s: Session): Promise<string | null> {
  return agreedPlanFor(s.deps.db, s.input.identity.threadId, s.input.projectRoots[0] ?? null).catch(
    (error: unknown) => {
      console.error('Could not load the agreed plan', error);
      return null;
    },
  );
}

async function planBuiltEarlier(s: Session): Promise<boolean> {
  const threadId = s.input.identity.threadId;
  const plan = await latestApprovedPlan(s.deps.db, threadId).catch(() => null);
  if (!plan) return false;
  return builtSinceApproval(s.deps.db, threadId, plan, s.lease.runId).catch(() => false);
}

export const RESEARCH_BRIEF = [
  '## Research',
  'This is a research request. Use read-only tools, `spark_find` to locate the code (ranked files with declarations as name@startLine-endLine; a hint, not a limit) and the project Map (`spark_map`) to find the answer. Never edit files or run commands that change anything.',
  'Answer with your findings, each tied to the files and lines you read, then a short list of suggested next steps.',
].join('\n');

const READ_ONLY_HONESTY =
  'This turn only reads. When a command or edit is refused, say plainly that it did not run and why; never report it as done or running. Offer to do it once the user says to make the change.';

const PR_CHECKS_BRIEF =
  "The question is about a pull request's checks. Read them with `spark_pull_requests` and `spark_pr` (checks, reviews, comments) before answering; the local diff does not show why CI failed. If those tools are not offered, say that the PR's check data is not available here.";

export async function readerPreamble(s: Session): Promise<string | null> {
  const plan = await agreedPlanText(s);
  const research = turnCategory(s.intake.outcome, s.intake.body.rules.intent) === 'research';
  const inProject = s.input.projectRoots.length > 0;
  const parts = [
    plan,
    research ? RESEARCH_BRIEF : null,
    asksAboutPrChecksByRule(s.input.userRequest) ? PR_CHECKS_BRIEF : null,
    inProject ? READ_ONLY_HONESTY : null,
    await codeContext(s),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

export function withCrewNotes(request: string, notes: readonly CrewNote[]): string {
  if (notes.length === 0) return request;
  const lines = notes.map(
    (note) => `- You → ${note.name}: ${note.body.replace(/\s+/g, ' ').trim()}`,
  );
  return `${request}\n\nWhile the crew worked, the user also said:\n${lines.join('\n')}`;
}

export async function promptFor(s: Session, spawn: Spawn): Promise<string> {
  const notes = await deliveredToCrew(s.deps.db, s.lease.runId).catch(() => []);
  const request = withCrewNotes(s.input.userRequest, notes);
  const agreedPlan = await agreedPlanText(s);
  if (spawn.role === 'critic') {
    const changes = await changesForReview(s);
    const rechecking = s.flow.review.fixing;
    s.fixPatch = rechecking ? await fixDiff(s) : null;
    return criticPrompt({
      pieces: pieceReviews(s.coordination?.list, changes.patch),
      request,
      plan: s.plan.map((entry) => entry.content),
      changes: changes.files,
      patch: changes.patch,
      checks: s.checkLines,
      buildStyle: s.buildStyle,
      agreedPlan,
      planBuilt: agreedPlan ? await planBuiltEarlier(s) : false,
      previousFindings: rechecking ? s.flow.review.fixable : [],
      earlierNotes: rechecking ? (s.reviewNotes ?? []) : [],
      fixPatch: s.fixPatch,
      builderReply: s.results.findLast((result) => result.role === 'builder')?.text ?? null,
      removals: removalFindings(changes.patch, lawFacts(s, agreedPlan)).map((item) => item.text),
    });
  }
  return builderPrompt({
    request,
    history: s.input.history,
    projectNote: s.input.projectMove ? projectMoveNote(s.input.projectMove) : null,
    note: spawn.note,
    findings: [],
    buildStyle: s.buildStyle,
    checkCommands: checkCommands(s),
    agreedPlan,
    likelyFiles: await codeContext(s),
    publish: await publishBrief(s.deps.db, s.input),
  });
}
