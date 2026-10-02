import { turnCategory } from '../advisor/intake-recorder.ts';
import { agreedPlanFor } from '../plans/plan-staleness.ts';
import { gitDiffBetween, gitDiffSince, headCommit } from '../projects/snapshot.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import { projectMoveNote } from '../workflow/project-move.ts';
import { builderPrompt, criticPrompt, type ChangedFile } from './context.ts';
import { awaitRanking, likelyFilesLine } from './likely-files.ts';
import { pieceReviews } from '../coordinator/critic-pieces.ts';
import { lawFacts } from '../laws/review.ts';
import { removalFindings } from '../laws/removals.ts';
import { fixDiff } from './fix-rounds.ts';
import type { Session } from './session.ts';
import type { Spawn } from './transitions.ts';

export interface ChangeSummary {
  files: ChangedFile[];
  patch: string;
}

interface GitSnapshot {
  root: string;
  ref: string;
}

async function gitSnapshot(s: Session): Promise<GitSnapshot | null> {
  const state = await getSnapshot(s.deps.db, s.input.workspaceId, s.lease.runId);
  const snapshot = state?.snapshot;
  if (!snapshot || snapshot.kind !== 'git' || !snapshot.ref) return null;
  return { root: snapshot.root, ref: snapshot.ref };
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
  const snapshot = await gitSnapshot(s);
  if (!snapshot) return { files: [], patch: '' };
  const diff = await gitDiffSince(snapshot.root, snapshot.ref).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : { files: [], patch: '' };
}

export async function changesForReview(s: Session): Promise<ChangeSummary> {
  const own = await changesSoFar(s);
  const snapshot = await gitSnapshot(s);
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

export const RESEARCH_BRIEF = [
  '## Research',
  'This is a research request. Use read-only tools and the project Map (`spark_map`) to find the answer. Never edit files or run commands that change anything.',
  'Answer with your findings, each tied to the files and lines you read, then a short list of suggested next steps.',
].join('\n');

export async function readerPreamble(s: Session): Promise<string | null> {
  const plan = await agreedPlanText(s);
  const research = turnCategory(s.intake.outcome, s.intake.body.rules.intent) === 'research';
  const parts = [plan, research ? RESEARCH_BRIEF : null].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

export async function promptFor(s: Session, spawn: Spawn): Promise<string> {
  const request = s.input.userRequest;
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
    likelyFiles: likelyFilesLine(await awaitRanking(s)),
  });
}
