import {
  CHECKPOINT_OPTION,
  preferredShipMode,
  type InvolvementLevel,
  type ShipResult,
  type TaskPiece,
} from '@spark-outpost/contracts';
import { insertApproval } from '../persistence/approvals.ts';
import { shipsFailingChecks } from '../persistence/setup.ts';
import { runChanges } from '../projects/run-changes.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { runCommand } from '../setup/command.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { planShip, type ShipDeps, type ShipOptions, type ShipPlan } from '../ship/prepare.ts';
import { shipPiece, shipTask } from '../ship/service.ts';
import { runEvents } from '../workflow/run-events.ts';
import { checkBudget } from './budget-check.ts';
import { checksFailing } from './check-results.ts';
import { acceptCard, checkpointApproval } from './checkpoint.ts';
import { RISKY_PR_NOTE } from './checkpoint-policy.ts';
import { assumptionPrNote } from './clarify.ts';
import { criticSkippedLine, sessionReviewLine } from './critic-fix.ts';
import { changedLines } from './member-prompts.ts';
import { choosePrSplit, ownWorktreePieces } from './pr-split.ts';
import { publish, type Session } from './session.ts';
import { lawItems, lawsNote } from '../laws/review.ts';
import type { FlowEvent } from './transitions.ts';

export const CHECKS_FAILING_NOTE = 'Checks failing';
export const UNVERIFIED_NOTE = 'Jev could not verify this change';
export const KEPT_BY_FULL_AUTO = 'Full auto → PR kept the changes and went on to ship them.';
export const CHECKS_HOLD_REASON =
  'The checks still fail after the fix turns, and Full auto → PR is set to stop before opening a PR when they do. Keep the change and ship it yourself, ask for a fix, or revert.';

function shipDeps(s: Session): ShipDeps {
  const access = s.deps.shipAccess ?? {
    secrets: memorySecretStore(),
    runCommand,
    locateGh: async () => null,
    fetch,
  };
  return {
    ...access,
    db: s.deps.db,
    workspaceId: s.input.workspaceId,
    branchPrefix: s.deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
  };
}

export async function autoKeep(
  s: Session,
  keptBy: InvolvementLevel,
  lines: readonly (string | null)[],
): Promise<void> {
  const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
  const reason = lines.filter((line): line is string => Boolean(line)).join(' ');
  const plain = acceptCard(changes.files, reason, null, lawItems(s), await changedLines(s));
  const card = { ...plain, payload: { ...plain.payload, keptBy } };
  s.checkpoints += 1;
  const kept = await insertApproval(
    s.deps.db,
    checkpointApproval(s.lease.runId, card, s.checkpoints),
    { status: 'allowed', decidedBy: 'level', optionId: CHECKPOINT_OPTION.keep },
  );
  await s.append(runEvents.approvalRequested(kept));
  await s.append(runEvents.approvalDecided(kept));
  await publish(s);
}

function pullRequestLine(result: ShipResult, failing: boolean): string {
  const pull = result.pullRequest!;
  const verb = pull.created ? 'Opened' : 'Updated';
  const kind = pull.draft ? 'draft PR' : 'PR';
  const marked = failing ? ', marked "Checks failing"' : '';
  return `${verb} ${kind} #${pull.number}${marked}: ${pull.url}`;
}

function checkoutLine(current: string | null, branch: string): string {
  if (current === branch) return `The change is on ${branch} in this chat's worktree.`;
  if (current) {
    return `Your checkout stays on ${current} with the change in your working tree; the PR branch is ${branch}.`;
  }
  return `The branch is ${branch}.`;
}

function shippedLine(result: ShipResult, plan: ShipPlan, failing: boolean): string {
  const checkout = checkoutLine(plan.repo?.branch ?? null, result.branch);
  if (result.pullRequest) return `${pullRequestLine(result, failing)}\n\n${checkout}`;
  const why = plan.notes[0] ? ` ${plan.notes[0]}` : '';
  if (result.pushed) {
    return `Pushed ${result.branch} to ${plan.remote?.name ?? 'the remote'} without a pull request.${why}`;
  }
  const commit = result.commit ? ` ${result.commit.slice(0, 7)}` : '';
  return `Committed${commit} on ${result.branch}, not pushed.${why}`;
}

async function opensPullRequest(s: Session): Promise<boolean> {
  if (!s.taskId) return false;
  const plan = await planShip(shipDeps(s), s.taskId, { keepCheckout: true, duringRun: true }).catch(
    () => null,
  );
  return plan !== null && !plan.blocked && plan.modes.includes('draft_pr');
}

export async function shipFullAuto(s: Session): Promise<FlowEvent> {
  const hit = await checkBudget(s);
  if (hit) return { type: 'budget_exceeded', limit: hit, unstarted: true };
  const failing = checksFailing(s);
  if (failing && !(await shipsFailingChecks(s.deps.db, s.input.workspaceId))) {
    return { type: 'ship_held', reason: CHECKS_HOLD_REASON };
  }
  const pieces = ownWorktreePieces(s);
  const split =
    pieces.length > 1 && (await opensPullRequest(s)) ? await choosePrSplit(s, pieces) : 'one';
  if (!split) return { type: 'stopped' };
  s.shipLine = await ship(s, failing, split === 'separate' ? pieces : []);
  await autoKeep(s, 'full-auto', [KEPT_BY_FULL_AUTO, sessionReviewLine(s), s.shipLine]);
  return { type: 'shipped' };
}

export function shipFailureLine(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Full auto → PR kept the change but could not ship it: ${reason}`;
}

async function shipPieces(
  s: Session,
  deps: ShipDeps,
  pieces: readonly TaskPiece[],
  options: ShipOptions,
): Promise<string[]> {
  const lines: string[] = [];
  for (const piece of pieces) {
    const files = piece.filesChanged;
    try {
      const result = await shipPiece(deps, s.taskId!, { ...piece, files }, options);
      lines.push(`${piece.key}: ${pullRequestLine(result, false)}`);
    } catch (error) {
      lines.push(`${piece.key}: ${shipFailureLine(error)}`);
    }
  }
  return lines;
}

async function ship(s: Session, failing: boolean, separate: readonly TaskPiece[]): Promise<string> {
  if (!s.taskId) return 'Full auto → PR kept the change, but it has no task to ship.';
  const notes = [
    failing ? CHECKS_FAILING_NOTE : null,
    s.unverified ? UNVERIFIED_NOTE : null,
    s.risky ? RISKY_PR_NOTE : null,
    s.assumption ? assumptionPrNote(s.assumption) : null,
    criticSkippedLine(s),
    lawsNote(s),
    ...(s.prNotes ?? []),
  ].filter((note): note is string => note !== null);
  const deps = shipDeps(s);
  const pieceLines = await shipPieces(s, deps, separate, { duringRun: true, notes });
  const exclude = separate.flatMap((piece) => piece.filesChanged);
  const options = {
    keepCheckout: true,
    duringRun: true,
    notes,
    exclude,
    ...(failing ? { draft: true } : {}),
  };
  const main = await shipMain(s, deps, failing, options, separate.length > 0);
  return [...pieceLines, ...(main ? [main] : [])].join('\n\n');
}

async function shipMain(
  s: Session,
  deps: ShipDeps,
  failing: boolean,
  options: ShipOptions,
  piecesShipped: boolean,
): Promise<string | null> {
  try {
    const plan = await planShip(deps, s.taskId!, options);
    if (piecesShipped && (plan.files.length === 0 || plan.blocked?.reason === 'nothing_new')) {
      return null;
    }
    const mode = plan.blocked ? null : preferredShipMode(plan.modes);
    if (!mode) {
      return `Full auto → PR kept the change but did not ship it: ${plan.blocked?.message ?? plan.notes[0] ?? 'there is nothing to ship.'}`;
    }
    const title = failing ? `[${CHECKS_FAILING_NOTE}] ${plan.task.title}` : plan.task.title;
    const result = await shipTask(deps, s.taskId!, { mode, title: title.slice(0, 200) }, options);
    return shippedLine(result, plan, failing);
  } catch (error) {
    return shipFailureLine(error);
  }
}
