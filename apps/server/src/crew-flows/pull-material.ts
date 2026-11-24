import {
  PULL_MOVING,
  ReviewSetupError,
  gatherMaterialFrom,
  reachablePull,
  renderMaterial,
} from '../github-inbox/review/material.ts';
import { hasProject, type Handoff } from '../orchestration/spark-child.ts';
import { recordObservation } from '../persistence/observations.ts';
import { DEFAULT_GITHUB_HOST } from '../ship/github/access.ts';
import type { PullPlace, PullRef } from './pr-checkout.ts';
import { pullHostNamedIn, pullNamedIn, type TurnWorkflowRun } from './run-records.ts';

export type PullRead =
  { kind: 'none' } | { kind: 'read'; material: string } | { kind: 'unreadable'; reason: string };

const NOT_RETURNED = 'GitHub did not return it';
const KEPT_CHANGING = 'it kept changing while Spark read it';

const noConnection = (pull: PullRef) => `no GitHub connection reaches ${pull.owner}/${pull.repo}`;

function hostOf(turn: TurnWorkflowRun, pull: PullRef): string {
  const named = pullNamedIn(turn.message) === pull.id ? pullHostNamedIn(turn.message) : null;
  return named ?? DEFAULT_GITHUB_HOST;
}

function reasonOf(error: unknown): string {
  if (error instanceof ReviewSetupError && error.message === PULL_MOVING) return KEPT_CHANGING;
  return NOT_RETURNED;
}

async function readFromGitHub(h: Handoff, turn: TurnWorkflowRun, pull: PullRef): Promise<PullRead> {
  const access = h.deps.shipAccess;
  if (!access) return { kind: 'unreadable', reason: noConnection(pull) };
  const deps = { ...access, db: h.deps.db, workspaceId: h.input.workspaceId };
  const found = await reachablePull(deps, pull.id, hostOf(turn, pull)).catch(() => null);
  if (!found) return { kind: 'unreadable', reason: noConnection(pull) };
  try {
    const facts = await gatherMaterialFrom(deps, found, pull.id, null);
    return { kind: 'read', material: renderMaterial(facts) };
  } catch (error) {
    return { kind: 'unreadable', reason: reasonOf(error) };
  }
}

export async function readRunPull(
  h: Handoff,
  turn: TurnWorkflowRun,
  place: PullPlace,
): Promise<PullRead> {
  if (place.kind !== 'unlinked' && place.kind !== 'unfetched') return { kind: 'none' };
  const read = await readFromGitHub(h, turn, place.pull);
  if (read.kind === 'read' && place.kind === 'unlinked') {
    await recordObservation(h.deps.db, h.lease.runId, {
      source: 'private_data',
      label: `private work data (pull request ${place.pull.id})`,
    });
  }
  return read;
}

export function pullBlocksRun(
  h: Handoff,
  read: PullRead,
): read is PullRead & { kind: 'unreadable' } {
  return read.kind === 'unreadable' && !hasProject(h.input);
}

export function pullBlockedLine(workflowName: string, pull: PullRef, reason: string): string {
  return `Workflow ${workflowName} did not start: this chat has no project folder and Spark could not read pull request ${pull.id} from GitHub (${reason}), so its steps would have nothing to read. Connect GitHub in Settings → Connectors or link the repository as a project, then send the message again.`;
}
