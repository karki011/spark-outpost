import type {
  ShipFile,
  ShipMode,
  ShipPreview,
  ShipRequest,
  ShipResult,
  TaskLink,
} from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import { coreImpact, hasCoreImpact } from '../map/impact.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import { latestApprovedPlan } from '../persistence/plan-documents.ts';
import { saveTaskShip, type TaskShip } from '../persistence/task-ships.ts';
import { addTaskLink } from '../persistence/tasks.ts';
import { safeToPush } from './branch.ts';
import {
  branchTip,
  commitFiles,
  commitOnBranch,
  createBranch,
  filesBetween,
  harnessCommitsToPush,
  pushBranch,
  remoteDefaultBranch,
  remoteHasBranch,
} from './git.ts';
import type { PullRequest } from './github/connection.ts';
import { commitBody, commitSubject, pullRequestBody, type ShipSummary } from './message.ts';
import {
  planShip,
  previewOf,
  ShipBlockedError,
  shipTitle,
  type ShipDeps,
  type ShipOptions,
  type ShipPlan,
} from './prepare.ts';
import { repoSlug } from './remote.ts';
import { syncTicketsAfterShip } from '../tickets/ship-sync.ts';

const running = new Map<string, Promise<unknown>>();

function serialized<T>(taskId: string, work: () => Promise<T>): Promise<T> {
  const previous = running.get(taskId) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.catch(() => undefined);
  running.set(taskId, settled);
  void settled.then(() => {
    if (running.get(taskId) === settled) running.delete(taskId);
  });
  return next;
}

export async function shipPreview(deps: ShipDeps, taskId: string): Promise<ShipPreview> {
  return previewOf(await planShip(deps, taskId));
}

async function pullRequestImpact(deps: ShipDeps, plan: ShipPlan, files: readonly ShipFile[]) {
  if (!plan.root) return null;
  const impact = await coreImpact(
    deps.db,
    plan.root,
    files.map((file) => file.path),
  );
  return hasCoreImpact(impact) ? impact : null;
}

async function summaryFor(
  deps: ShipDeps,
  plan: ShipPlan,
  title: string,
  files: ShipFile[],
  notes: readonly string[] = [],
) {
  const summary: ShipSummary = {
    notes,
    title,
    summary: plan.facts?.summary ?? null,
    files,
    checks: plan.facts?.checks ?? [],
    review: plan.facts?.review ?? null,
    costUsd: plan.task.costUsd,
    costEstimated: plan.task.costSource === 'estimated' || plan.task.costSource === 'mixed',
    plan: await latestApprovedPlan(deps.db, plan.task.conversationId),
    coreImpact: await pullRequestImpact(deps, plan, files),
    tickets: plan.tickets,
  };
  return summary;
}

interface Progress {
  ship: TaskShip;
  commit: string | null;
  committedFiles: string[];
  pushed: boolean;
  pullRequest: (PullRequest & { created: boolean }) | null;
  link: TaskLink | null;
}

async function commitWithoutCheckout(
  plan: ShipPlan,
  subject: string,
  body: string,
): Promise<string | null> {
  const root = plan.root!;
  const start = (plan.branchExists ? await branchTip(root, plan.branch) : null) ?? plan.repo!.head!;
  return commitOnBranch(root, plan.repo!.prefix, plan.paths, plan.branch, start, subject, body);
}

async function commitStep(
  deps: ShipDeps,
  plan: ShipPlan,
  title: string,
  progress: Progress,
  notes: readonly string[],
) {
  if (plan.files.length === 0) return;
  const root = plan.root!;
  const summary = await summaryFor(deps, plan, title, plan.files, notes);
  const subject = commitSubject(title);
  const body = commitBody(summary);
  if (plan.keepCheckout) {
    const commit = await commitWithoutCheckout(plan, subject, body);
    if (!commit) return;
    progress.commit = commit;
  } else {
    if (!plan.branchExists) await createBranch(root, plan.branch);
    progress.commit = await commitFiles(root, plan.repo!.prefix, plan.files, subject, body);
  }
  progress.committedFiles = plan.files.map((file) => file.path);
  progress.ship = { ...progress.ship, lastCommit: progress.commit };
  await saveTaskShip(deps.db, plan.task.id, progress.ship);
}

async function pushStep(deps: ShipDeps, plan: ShipPlan, progress: Progress) {
  const remote = plan.remote!;
  const defaultBranch = await remoteDefaultBranch(plan.root!, remote.name);
  if (
    !safeToPush(plan.branch, deps.branchPrefix, [plan.baseBranch, defaultBranch, 'main', 'master'])
  ) {
    throw new ShipBlockedError(`Ship only pushes its own ${deps.branchPrefix}/ branches.`);
  }
  const internal = await harnessCommitsToPush(plan.root!, remote.name, plan.branch);
  if (internal.length > 0) {
    throw new ShipBlockedError(
      `${plan.branch} carries Spark Outpost's internal commits (${internal.slice(0, 3).join('; ')}), so it was not pushed.`,
    );
  }
  await pushBranch(plan.root!, remote.name, plan.branch);
  progress.pushed = true;
  progress.ship = { ...progress.ship, remote: remote.name, pushedAt: new Date() };
  await saveTaskShip(deps.db, plan.task.id, progress.ship);
}

async function pullRequestFiles(plan: ShipPlan, base: string): Promise<ShipFile[]> {
  const root = plan.root!;
  const remote = plan.remote!.name;
  if (!(await remoteHasBranch(root, remote, base))) return plan.files;
  return filesBetween(root, plan.repo!.prefix, `refs/remotes/${remote}/${base}`, plan.branch);
}

async function pullRequestStep(
  deps: ShipDeps,
  plan: ShipPlan,
  title: string,
  progress: Progress,
  notes: readonly string[],
) {
  const github = plan.github!;
  const repo = plan.remoteRepo!;
  const base = plan.baseBranch ?? (await github.defaultBranch(repo));
  if (base === plan.branch) throw new ShipBlockedError('The branch and its base are the same.');
  const summary = await summaryFor(deps, plan, title, await pullRequestFiles(plan, base), notes);
  const body = pullRequestBody(summary);
  const existing = await github.findPullRequest(repo, plan.branch);
  const pull = existing
    ? await github.updatePullRequest(repo, existing.number, { title, body })
    : await github.createPullRequest(repo, { title, body, head: plan.branch, base });
  progress.pullRequest = { ...pull, created: existing === null };
  progress.ship = { ...progress.ship, baseBranch: base, prUrl: pull.url, prNumber: pull.number };
  await saveTaskShip(deps.db, plan.task.id, progress.ship);
  const { link } = await addTaskLink(deps.db, plan.task.id, {
    kind: 'pr',
    url: pull.url,
    title: `${repoSlug(repo)}#${pull.number}`,
    source: 'ship',
  });
  progress.link = link;
  await syncTicketsAfterShip(deps, plan.task.id, { url: pull.url, title: link.title ?? pull.url });
}

async function audit(
  deps: ShipDeps,
  plan: ShipPlan,
  mode: ShipMode,
  progress: Progress,
  error: string | null,
) {
  const runId = plan.facts?.auditRunId;
  if (!runId) return;
  const payload = redactValue({
    mode,
    outcome: error ? 'failed' : 'succeeded',
    error,
    branch: plan.branch,
    base: progress.ship.baseBranch,
    commit: progress.commit,
    files: progress.committedFiles,
    skipped: plan.skipped.map((file) => file.path),
    remote: plan.remote?.name ?? null,
    repo: plan.remoteRepo ? `${plan.remoteRepo.host}/${repoSlug(plan.remoteRepo)}` : null,
    pushed: progress.pushed,
    pullRequest: progress.pullRequest,
    github: plan.github?.method ?? null,
    keepsCheckout: plan.keepCheckout,
  });
  await insertFinishedRunEntries(deps.db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'ship',
      method: `ship/${mode}`,
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

async function runShip(
  deps: ShipDeps,
  taskId: string,
  request: ShipRequest,
  options: ShipOptions,
): Promise<ShipResult> {
  const plan = await planShip(deps, taskId, options);
  const notes = options.notes ?? [];
  if (plan.blocked) throw new ShipBlockedError(plan.blocked.message);
  if (!plan.modes.includes(request.mode)) {
    throw new ShipBlockedError(plan.notes[0] ?? 'That kind of ship isn’t available for this task.');
  }
  const title = shipTitle(plan, request.title);
  const progress: Progress = {
    ship: plan.shipped ?? {
      rootPath: plan.root!,
      branch: plan.branch,
      baseBranch: plan.baseBranch,
      remote: plan.remote?.name ?? null,
      lastCommit: null,
      pushedAt: null,
      prUrl: null,
      prNumber: null,
      keepsCheckout: plan.keepCheckout,
    },
    commit: null,
    committedFiles: [],
    pushed: false,
    pullRequest: null,
    link: null,
  };
  try {
    await commitStep(deps, plan, title, progress, notes);
    if (request.mode !== 'commit') await pushStep(deps, plan, progress);
    if (request.mode === 'draft_pr') await pullRequestStep(deps, plan, title, progress, notes);
  } catch (error) {
    await audit(deps, plan, request.mode, progress, (error as Error).message);
    throw error;
  }
  await audit(deps, plan, request.mode, progress, null);
  return {
    mode: request.mode,
    branch: plan.branch,
    commit: progress.commit,
    committedFiles: progress.committedFiles,
    pushed: progress.pushed,
    pullRequest: progress.pullRequest,
    link: progress.link,
  };
}

export function shipTask(
  deps: ShipDeps,
  taskId: string,
  request: ShipRequest,
  options: ShipOptions = {},
): Promise<ShipResult> {
  return serialized(taskId, () => runShip(deps, taskId, request, options));
}
