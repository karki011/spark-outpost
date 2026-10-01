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
import { opensDraftPullRequests } from '../persistence/pr-settings.ts';
import { watchPullRequest } from '../persistence/pr-watches.ts';
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

export async function shipPreview(
  deps: ShipDeps,
  taskId: string,
  options: ShipOptions = {},
): Promise<ShipPreview> {
  return previewOf(await planShip(deps, taskId, options));
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
  pullRequest: (PullRequest & { created: boolean; draft?: boolean }) | null;
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

async function draftFor(deps: ShipDeps, options: ShipOptions): Promise<boolean> {
  return options.draft ?? (await opensDraftPullRequests(deps.db, deps.workspaceId));
}

async function watchShipped(
  deps: ShipDeps,
  plan: ShipPlan,
  pull: PullRequest,
  branch: string,
  draft: boolean,
) {
  const repo = plan.remoteRepo!;
  await watchPullRequest(deps.db, {
    workspaceId: deps.workspaceId,
    conversationId: plan.task.conversationId,
    taskId: plan.task.id,
    host: repo.host,
    owner: repo.owner,
    repo: repo.name,
    number: pull.number,
    url: pull.url,
    branch,
    draft,
  });
}

async function pullRequestStep(
  deps: ShipDeps,
  plan: ShipPlan,
  title: string,
  progress: Progress,
  options: ShipOptions,
) {
  const github = plan.github!;
  const repo = plan.remoteRepo!;
  const base = plan.baseBranch ?? (await github.defaultBranch(repo));
  if (base === plan.branch) throw new ShipBlockedError('The branch and its base are the same.');
  const files = await pullRequestFiles(plan, base);
  const summary = await summaryFor(deps, plan, title, files, options.notes ?? []);
  const body = pullRequestBody(summary);
  const existing = await github.findPullRequest(repo, plan.branch);
  const draft = await draftFor(deps, options);
  const pull = existing
    ? await github.updatePullRequest(repo, existing.number, { title, body })
    : await github.createPullRequest(repo, { title, body, head: plan.branch, base, draft });
  progress.pullRequest = existing ? { ...pull, created: false } : { ...pull, created: true, draft };
  progress.ship = { ...progress.ship, baseBranch: base, prUrl: pull.url, prNumber: pull.number };
  await saveTaskShip(deps.db, plan.task.id, progress.ship);
  const { link } = await addTaskLink(deps.db, plan.task.id, {
    kind: 'pr',
    url: pull.url,
    title: `${repoSlug(repo)}#${pull.number}`,
    source: 'ship',
  });
  progress.link = link;
  await watchShipped(deps, plan, pull, plan.branch, existing === null && draft);
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
    if (request.mode === 'draft_pr') await pullRequestStep(deps, plan, title, progress, options);
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

export interface ShipPiece {
  key: string;
  title: string;
  files: readonly string[];
}

async function pushOwnBranch(deps: ShipDeps, plan: ShipPlan, branch: string): Promise<void> {
  const remote = plan.remote!.name;
  const defaultBranch = await remoteDefaultBranch(plan.root!, remote);
  if (!safeToPush(branch, deps.branchPrefix, [plan.baseBranch, defaultBranch, 'main', 'master'])) {
    throw new ShipBlockedError(`Ship only pushes its own ${deps.branchPrefix}/ branches.`);
  }
  await pushBranch(plan.root!, remote, branch);
}

async function runPieceShip(
  deps: ShipDeps,
  taskId: string,
  piece: ShipPiece,
  options: ShipOptions,
): Promise<ShipResult> {
  const plan = await planShip(deps, taskId, { ...options, keepCheckout: true });
  if (plan.blocked) throw new ShipBlockedError(plan.blocked.message);
  if (!plan.modes.includes('draft_pr')) {
    throw new ShipBlockedError(plan.notes[0] ?? 'This task can’t open a pull request.');
  }
  const paths = plan.paths.filter((path) => piece.files.includes(path));
  const files = plan.files.filter((file) => paths.includes(file.path));
  const branch = `${plan.branch}-${piece.key.toLowerCase()}`;
  const title = shipTitle(plan, `${plan.task.title}: ${piece.title}`);
  const summary = await summaryFor(deps, plan, title, files, options.notes ?? []);
  const commit = await commitOnBranch(
    plan.root!,
    plan.repo!.prefix,
    paths,
    branch,
    plan.repo!.head!,
    commitSubject(title),
    commitBody(summary),
  );
  if (!commit) throw new ShipBlockedError(`${piece.key} has no changes to ship.`);
  await pushOwnBranch(deps, plan, branch);
  const github = plan.github!;
  const repo = plan.remoteRepo!;
  const base = plan.baseBranch ?? (await github.defaultBranch(repo));
  const body = pullRequestBody(summary);
  const existing = await github.findPullRequest(repo, branch);
  const draft = await draftFor(deps, options);
  const pull = existing
    ? await github.updatePullRequest(repo, existing.number, { title, body })
    : await github.createPullRequest(repo, { title, body, head: branch, base, draft });
  const { link } = await addTaskLink(deps.db, plan.task.id, {
    kind: 'pr',
    url: pull.url,
    title: `${repoSlug(repo)}#${pull.number}`,
    source: 'ship',
  });
  await watchShipped(deps, plan, pull, branch, existing === null && draft);
  return {
    mode: 'draft_pr',
    branch,
    commit,
    committedFiles: paths,
    pushed: true,
    pullRequest: existing ? { ...pull, created: false } : { ...pull, created: true, draft },
    link,
  };
}

export function shipPiece(
  deps: ShipDeps,
  taskId: string,
  piece: ShipPiece,
  options: ShipOptions = {},
): Promise<ShipResult> {
  return serialized(taskId, () => runPieceShip(deps, taskId, piece, options));
}
