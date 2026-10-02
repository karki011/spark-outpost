import { access } from 'node:fs/promises';
import path from 'node:path';
import type { JevStatus } from '@spark-outpost/contracts';
import { BUILDER_TASKS_MAX } from '../advisor/policy.ts';
import { callJev, type JevCall } from '../orchestration/jev-calls.ts';
import { destructiveTargets } from '../orchestration/risk-rules.ts';
import type { Session } from '../orchestration/session.ts';
import type { Assessment } from './assess.ts';
import { projectSettings } from './builder-env.ts';
import {
  BUILDERS_KEY,
  countQuestion,
  countVerdict,
  pieceKey,
  planTasks,
  readCount,
  type CountVerdict,
} from './builder-count.ts';
import { groupAnswer, groupTasks, type GroupTask } from './builder-groups.ts';
import { riskyAnswer } from './piece-demand.ts';
import { loadFileFacts, type FileFacts } from './piece-facts.ts';
import {
  pieceQuestions,
  readPieceAnswers,
  type JevPiece,
  type PieceAnswer,
  type PieceAsk,
} from './piece-questions.ts';
import { inOrderReason } from './place-list.ts';
import type { PlanStep } from './plan-coverage.ts';
import { inMigrationsFolder } from './placement.ts';

export const JEV_NOT_CONNECTED = 'Jev not connected';

export interface BuilderPlan {
  call: JevCall | null;
  status: JevStatus;
  tasks: readonly JevPiece[];
  verdict: CountVerdict | null;
  builders: number | null;
  groups: string[][] | null;
  steps: PlanStep[][] | null;
  answers: ReadonlyMap<string, PieceAnswer> | null;
  placementAsked: boolean;
  reason: string;
}

function jevFailure(call: JevCall): string {
  if (call.status === 'timed_out') return 'Jev timed out';
  return `Jev failed: ${call.error ?? 'unknown error'}`;
}

function skipReason(s: Session, tasks: number): string | null {
  if (!s.jev) return JEV_NOT_CONNECTED;
  if (tasks < 2) return 'Jev not asked: the plan has fewer than 2 items';
  if (tasks > BUILDER_TASKS_MAX) {
    return `Jev not asked: ${tasks} plan items, over ${BUILDER_TASKS_MAX}`;
  }
  return null;
}

function rulesPlan(
  s: Session,
  tasks: readonly JevPiece[],
  reason: string,
  call: JevCall | null = null,
  verdict: CountVerdict | null = null,
): BuilderPlan {
  return {
    call,
    status: call?.status ?? (s.jev ? 'not_asked' : 'not_connected'),
    tasks,
    verdict,
    builders: null,
    groups: null,
    steps: null,
    answers: null,
    placementAsked: false,
    reason,
  };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function repoOf(roots: readonly string[], files: readonly string[]): Promise<string> {
  for (const file of files) {
    for (const root of roots) if (await exists(path.join(root, file))) return root;
  }
  return roots[0] ?? '';
}

function areaNames(files: readonly string[], facts: ReadonlyMap<string, FileFacts>): string[] {
  return files.flatMap((file) => facts.get(file)?.area?.replace(/\s*\(.*$/, '') ?? []);
}

export function destructivePath(s: Session): (file: string) => boolean {
  const targets = new Set(destructiveTargets(s.input.userRequest));
  return (file) => inMigrationsFolder(file) || targets.has(file);
}

async function groupInputs(
  s: Session,
  tasks: readonly JevPiece[],
  facts: ReadonlyMap<string, FileFacts>,
  answers: ReadonlyMap<string, PieceAnswer>,
): Promise<GroupTask[]> {
  const isDestructive = destructivePath(s);
  return Promise.all(
    tasks.map(async (task) => {
      const answer = answers.get(task.key);
      const ruled = task.owns.some(isDestructive);
      return {
        key: task.key,
        files: task.owns,
        areas: areaNames(task.owns, facts),
        destructive: ruled || (answer !== undefined && riskyAnswer(answer)),
        repo: await repoOf(s.input.projectRoots, task.owns),
      };
    }),
  );
}

function headLine(verdict: Extract<CountVerdict, { confident: true }>, builders: number): string {
  const count = `${verdict.asked} ${verdict.asked === 1 ? 'Builder' : 'Builders'}`;
  const applied = builders === verdict.asked ? '' : ` → ${builders}`;
  return `Jev: ${count} (${verdict.confidence.toFixed(2)})${applied}`;
}

export function builderQuestions(ask: PieceAsk) {
  const built = pieceQuestions(ask);
  return { ...built, questions: { [BUILDERS_KEY]: countQuestion(), ...built.questions } };
}

export async function askBuilders(s: Session, assessment: Assessment): Promise<BuilderPlan> {
  const steps = assessment.planSteps;
  const tasks = planTasks(steps);
  const skipped = skipReason(s, tasks.length);
  if (skipped) return rulesPlan(s, tasks, skipped);
  const settings = await projectSettings(s.deps.db, s.lease.runId);
  const placementAsked = inOrderReason(s, settings) === null && !s.deps.forcedPlacement;
  const root = s.input.projectRoots[0]!;
  const paths = tasks.flatMap((task) => task.owns);
  const facts = await loadFileFacts(s.deps.db, root, paths, s.scanReport?.candidates ?? []);
  const ask: PieceAsk = {
    request: s.input.userRequest,
    pieces: tasks,
    facts,
    placement: placementAsked,
  };
  const call = await callJev(s.jev, () => builderQuestions(ask), s.control.signal);
  if (call.status !== 'answered' || !call.response) {
    return rulesPlan(s, tasks, jevFailure(call), call);
  }
  const verdict = countVerdict(readCount(call.response), {
    tasks: tasks.length,
    slots: settings.slots,
  });
  if (!verdict.confident) return rulesPlan(s, tasks, verdict.reason, call, verdict);
  if (verdict.count === 1 && assessment.engagement.reason === 'requested') {
    return rulesPlan(s, tasks, 'Jev picked 1 Builder, but you asked for pieces', call, verdict);
  }
  const taskAnswers = readPieceAnswers(call.response, ask);
  const groups = groupTasks(await groupInputs(s, tasks, facts, taskAnswers), verdict.count);
  const index = new Map(tasks.map((task, at) => [task.key, at]));
  const answers = new Map(
    groups.flatMap((keys, at) => {
      const answer = groupAnswer(keys, taskAnswers);
      return answer ? [[pieceKey(at), answer] as const] : [];
    }),
  );
  return {
    call,
    status: call.status,
    tasks,
    verdict,
    builders: groups.length,
    groups,
    steps: groups.map((keys) => keys.map((key) => steps[index.get(key)!]!)),
    answers,
    placementAsked,
    reason: headLine(verdict, groups.length),
  };
}
