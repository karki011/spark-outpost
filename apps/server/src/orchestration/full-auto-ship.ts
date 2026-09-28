import {
  CHECKPOINT_OPTION,
  preferredShipMode,
  type ShipMode,
  type ShipResult,
} from '@spark-outpost/contracts';
import { insertApproval } from '../persistence/approvals.ts';
import { shipsFailingChecks } from '../persistence/setup.ts';
import { runChanges } from '../projects/run-changes.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { runCommand } from '../setup/command.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { planShip, type ShipDeps, type ShipPlan } from '../ship/prepare.ts';
import { shipTask } from '../ship/service.ts';
import { runEvents } from '../workflow/run-events.ts';
import { checkBudget } from './budget-check.ts';
import { acceptCard } from './checkpoint.ts';
import { RISKY_PR_NOTE } from './checkpoint-policy.ts';
import { assumptionPrNote } from './clarify.ts';
import { latestChecks } from './final-message.ts';
import { sessionReviewLine } from './critic-fix.ts';
import { publish, type Session } from './session.ts';
import type { FlowEvent } from './transitions.ts';

export const CHECKS_FAILING_NOTE = 'Checks failing';
export const UNVERIFIED_NOTE = 'Jev could not verify this change';
export const KEPT_BY_FULL_AUTO = 'Full auto kept the changes and went on to ship them.';
export const CHECKS_HOLD_REASON =
  'The checks still fail after the fix turns, and Full auto is set to stop before opening a draft PR when they do. Keep the change and ship it yourself, ask for a fix, or revert.';

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

export function checksFailing(s: Session): boolean {
  return latestChecks(s.checkBodies).some((body) => body.status === 'failed');
}

export async function autoKeep(
  s: Session,
  keptBy: 'hands-off' | 'full-auto',
  lines: readonly (string | null)[],
): Promise<void> {
  const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
  const reason = lines.filter((line): line is string => Boolean(line)).join(' ');
  const plain = acceptCard(changes.files, reason);
  const card = { ...plain, payload: { ...plain.payload, keptBy } };
  s.checkpoints += 1;
  const kept = await insertApproval(
    s.deps.db,
    {
      runId: s.lease.runId,
      toolCallId: `checkpoint:${card.kind}:${s.checkpoints}`,
      rpcId: null,
      kind: card.kind,
      title: card.title,
      payload: {
        command: null,
        cwd: null,
        paths: [],
        diffs: [],
        truncated: false,
        checkpoint: card.payload,
      },
      options: card.options,
      reason: card.payload.reason,
    },
    { status: 'allowed', decidedBy: 'level', optionId: CHECKPOINT_OPTION.keep },
  );
  await s.append(runEvents.approvalRequested(kept));
  await s.append(runEvents.approvalDecided(kept));
  await publish(s);
}

function modeFor(plan: ShipPlan): ShipMode | null {
  return preferredShipMode(plan.modes);
}

function pullRequestLine(result: ShipResult, failing: boolean): string {
  const pull = result.pullRequest!;
  const verb = pull.created ? 'Opened' : 'Updated';
  const marked = failing ? ', marked "Checks failing"' : '';
  return `${verb} draft PR #${pull.number}${marked}: ${pull.url}`;
}

function shippedLine(result: ShipResult, plan: ShipPlan, failing: boolean): string {
  const checkout = plan.repo?.branch
    ? `Your checkout stays on ${plan.repo.branch} with the change in your working tree; the PR branch is ${result.branch}.`
    : `The branch is ${result.branch}.`;
  if (result.pullRequest) return `${pullRequestLine(result, failing)}\n\n${checkout}`;
  const why = plan.notes[0] ? ` ${plan.notes[0]}` : '';
  if (result.pushed) {
    return `Pushed ${result.branch} to ${plan.remote?.name ?? 'the remote'} without a pull request.${why}`;
  }
  const commit = result.commit ? ` ${result.commit.slice(0, 7)}` : '';
  return `Committed${commit} on ${result.branch}, not pushed.${why}`;
}

export async function shipFullAuto(s: Session): Promise<FlowEvent> {
  const hit = await checkBudget(s);
  if (hit) return { type: 'budget_exceeded', limit: hit, unstarted: true };
  const failing = checksFailing(s);
  if (failing && !(await shipsFailingChecks(s.deps.db, s.input.workspaceId))) {
    return { type: 'ship_held', reason: CHECKS_HOLD_REASON };
  }
  s.shipLine = await ship(s, failing);
  await autoKeep(s, 'full-auto', [KEPT_BY_FULL_AUTO, sessionReviewLine(s), s.shipLine]);
  return { type: 'shipped' };
}

async function ship(s: Session, failing: boolean): Promise<string> {
  if (!s.taskId) return 'Full auto kept the change, but it has no task to ship.';
  const notes = [
    failing ? CHECKS_FAILING_NOTE : null,
    s.unverified ? UNVERIFIED_NOTE : null,
    s.risky ? RISKY_PR_NOTE : null,
    s.assumption ? assumptionPrNote(s.assumption) : null,
  ].filter((note): note is string => note !== null);
  const deps = shipDeps(s);
  const options = { keepCheckout: true, duringRun: true, notes };
  try {
    const plan = await planShip(deps, s.taskId, options);
    const mode = plan.blocked ? null : modeFor(plan);
    if (!mode) {
      return `Full auto kept the change but did not ship it: ${plan.blocked?.message ?? plan.notes[0] ?? 'there is nothing to ship.'}`;
    }
    const title = failing ? `[${CHECKS_FAILING_NOTE}] ${plan.task.title}` : plan.task.title;
    const result = await shipTask(deps, s.taskId, { mode, title: title.slice(0, 200) }, options);
    return shippedLine(result, plan, failing);
  } catch (error) {
    return `Full auto kept the change but could not ship it: ${(error as Error).message}`;
  }
}
