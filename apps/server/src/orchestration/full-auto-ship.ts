import {
  CHECKPOINT_OPTION,
  clipAtWord,
  preferredShipMode,
  SHIP_TITLE_MAX_LENGTH,
  type InvolvementLevel,
  type ShipResult,
} from '@spark-outpost/contracts';
import { insertApproval } from '../persistence/approvals.ts';
import { taskTitle } from '../persistence/tasks.ts';
import { shipsFailingChecks } from '../persistence/setup.ts';
import { runChanges } from '../projects/run-changes.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { runCommand } from '../setup/command.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { planShip, type ShipDeps, type ShipOptions, type ShipPlan } from '../ship/prepare.ts';
import { shipTask } from '../ship/service.ts';
import { runEvents } from '../workflow/run-events.ts';
import {
  agentPublishPlan,
  NO_OWN_BRANCH_LINE,
  publishAsked,
  publishByAgent,
} from './agent-publish.ts';
import { checksFailing, unrelatedCheckNotes } from './check-results.ts';
import { replySoFar } from './final-message.ts';
import { acceptCard, checkpointApproval } from './checkpoint.ts';
import { KEPT_BY_AUTO_EDIT, RISKY_PR_NOTE } from './checkpoint-policy.ts';
import { criticSkippedLine, sessionReviewLine } from './critic-fix.ts';
import { changedLines } from './member-prompts.ts';
import { publish, type Session } from './session.ts';
import { code } from '../laws/finding.ts';
import { lawItems, lawsNote, outsidePlanFiles } from '../laws/review.ts';
import { checkTally, keptAt } from './result-facts.ts';
import type { FlowEvent } from './transitions.ts';

export const CHECKS_FAILING_NOTE = 'Checks failing';
export const UNVERIFIED_NOTE = 'Jev could not verify this change';
export const KEPT_TITLE = 'Changes kept';
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

const ROUTINE_LEADS: ReadonlySet<string> = new Set([KEPT_BY_FULL_AUTO, KEPT_BY_AUTO_EDIT]);
const PUBLISHED_PLAINLY = /^(?:Opened|Updated) (?:draft )?(?:PR|pull request) #\d+: /;

export function keptNote(lines: readonly (string | null)[]): string | null {
  const notable = lines.filter(
    (line): line is string =>
      Boolean(line) && !ROUTINE_LEADS.has(line!) && !PUBLISHED_PLAINLY.test(line!),
  );
  return notable.length > 0 ? notable.join(' ') : null;
}

export async function autoKeep(
  s: Session,
  keptBy: InvolvementLevel,
  lines: readonly (string | null)[],
): Promise<void> {
  const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
  const reason = lines.filter((line): line is string => Boolean(line)).join(' ');
  const changed = await changedLines(s);
  const plain = acceptCard(changes.files, reason, null, lawItems(s), changed, outsidePlanFiles(s));
  const card = {
    ...plain,
    title: KEPT_TITLE,
    payload: {
      ...plain.payload,
      keptBy,
      keptNote: keptNote(lines),
      checks: checkTally(s.checkBodies),
      keptAt: await keptAt(s),
    },
  };
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
  if (result.pushed && result.prLink) {
    return `Pushed ${result.branch}. ${result.prLink.label}: ${result.prLink.url}`;
  }
  if (result.pushed) {
    return `Pushed ${result.branch} to ${plan.remote?.name ?? 'the remote'} without a pull request.${why}`;
  }
  const commit = result.commit ? ` ${result.commit.slice(0, 7)}` : '';
  return `Committed${commit} on ${result.branch}, not pushed.${why}`;
}

export async function shipFullAuto(s: Session): Promise<FlowEvent> {
  const failing = checksFailing(s);
  if (failing && !(await shipsFailingChecks(s.deps.db, s.input.workspaceId))) {
    return { type: 'ship_held', reason: CHECKS_HOLD_REASON };
  }
  s.shipLine = await ship(s, failing);
  await autoKeep(s, 'full-auto', [KEPT_BY_FULL_AUTO, sessionReviewLine(s), s.shipLine]);
  return { type: 'shipped' };
}

export async function publishWhenAsked(s: Session): Promise<void> {
  if (!publishAsked(s)) return;
  const followUp = s.input.followUpRound === true;
  const plan = await agentPublishPlan(s);
  if (!plan) {
    s.shipLine = followUp ? null : NO_OWN_BRANCH_LINE;
    return;
  }
  const failing = checksFailing(s);
  const titlePrefix = failing ? `[${CHECKS_FAILING_NOTE}]` : null;
  const notes = unrelatedCheckNotes(s).map((note) => note.text);
  const unrelatedFailures = notes.length > 0;
  const told = { failing, titlePrefix, notes, unrelatedFailures };
  const facts = { ...told, ...(followUp ? { followUp } : {}) };
  s.shipLine = await publishByAgent(s, shipDeps(s), plan, facts);
}

export function shipFailureLine(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Full auto → PR kept the change but could not ship it: ${reason}`;
}

async function ship(s: Session, failing: boolean): Promise<string> {
  if (!s.taskId) return 'Full auto → PR kept the change, but it has no task to ship.';
  const laws = lawsNote(s);
  const unrelated = unrelatedCheckNotes(s);
  const notes = [
    failing ? CHECKS_FAILING_NOTE : null,
    s.flow.unverified ? UNVERIFIED_NOTE : null,
    s.risky ? RISKY_PR_NOTE : null,
    criticSkippedLine(s),
    laws,
    ...unrelated.filter((note) => !laws?.includes(code(note.command))).map((note) => note.text),
  ].filter((note): note is string => note !== null);
  const deps = shipDeps(s);
  const plan = await agentPublishPlan(s);
  if (plan) {
    const titlePrefix = failing ? `[${CHECKS_FAILING_NOTE}]` : null;
    const unrelatedFailures = unrelated.length > 0;
    return publishByAgent(s, deps, plan, { failing, titlePrefix, notes, unrelatedFailures });
  }
  const asked = taskTitle(s.input.userRequest);
  const options = {
    keepCheckout: true,
    duringRun: true,
    notes,
    subject: failing ? `[${CHECKS_FAILING_NOTE}] ${asked}` : asked,
    summary: replySoFar(s.results, s.message?.text ?? null),
    ...(failing ? { draft: true } : {}),
  };
  return shipMain(s, deps, failing, options);
}

async function shipMain(
  s: Session,
  deps: ShipDeps,
  failing: boolean,
  options: ShipOptions,
): Promise<string> {
  try {
    const plan = await planShip(deps, s.taskId!, options);
    const mode = plan.blocked ? null : preferredShipMode(plan.modes);
    if (!mode) {
      return `Full auto → PR kept the change but did not ship it: ${plan.blocked?.message ?? plan.notes[0] ?? 'there is nothing to ship.'}`;
    }
    const title = failing ? `[${CHECKS_FAILING_NOTE}] ${plan.task.title}` : plan.task.title;
    const result = await shipTask(
      deps,
      s.taskId!,
      { mode, title: clipAtWord(title, SHIP_TITLE_MAX_LENGTH) },
      options,
    );
    return shippedLine(result, plan, failing);
  } catch (error) {
    return shipFailureLine(error);
  }
}
