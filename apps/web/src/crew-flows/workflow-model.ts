import {
  CREW_SLUG_MAX,
  crewSlug,
  workflowStages,
  type WorkflowStep,
} from '@spark-outpost/contracts';

export interface SparkName {
  id: string;
  name: string;
}

export interface StepTarget extends SparkName {
  workflow?: boolean;
}

type Targeted = Pick<WorkflowStep, 'sparkId' | 'workflowId'>;

const WORKFLOW_TARGET = 'workflow:';

export function workflowTarget(workflowId: string): string {
  return `${WORKFLOW_TARGET}${workflowId}`;
}

export function targetKey(step: Targeted): string {
  return step.workflowId === undefined ? (step.sparkId ?? '') : workflowTarget(step.workflowId);
}

function targetFields(target: StepTarget): Targeted {
  return target.workflow ? { workflowId: target.id } : { sparkId: target.id };
}

export type MoveDirection = 'earlier' | 'later';

function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = crewSlug(name);
  if (!taken.has(base)) return base;
  for (let count = 2; ; count += 1) {
    const suffix = `-${count}`;
    const candidate = `${base.slice(0, CREW_SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function workflowId(name: string, taken: readonly string[]): string {
  return uniqueSlug(name, new Set(taken));
}

function newStep(
  steps: readonly WorkflowStep[],
  target: StepTarget,
  dependsOn: string[],
): WorkflowStep {
  return {
    id: uniqueSlug(target.name, new Set(steps.map((step) => step.id))),
    ...targetFields(target),
    prompt: '',
    dependsOn,
    join: 'all',
    onFailure: 'stop',
  };
}

export function addStep(
  steps: readonly WorkflowStep[],
  stage: number,
  spark: StepTarget,
): WorkflowStep[] {
  const stages = workflowStages(steps);
  const parents = stage > 0 ? (stages[stage - 1] ?? []) : [];
  return [...steps, newStep(steps, spark, [...parents])];
}

export function addStage(steps: readonly WorkflowStep[], spark: StepTarget): WorkflowStep[] {
  return addStep(steps, workflowStages(steps).length, spark);
}

function without(steps: readonly WorkflowStep[], id: string): WorkflowStep[] {
  const removed = steps.find((step) => step.id === id);
  if (!removed) return [...steps];
  return steps
    .filter((step) => step.id !== id)
    .map((step) => {
      if (!step.dependsOn.includes(id)) return step;
      const inherited = step.dependsOn.flatMap((parent) =>
        parent === id ? removed.dependsOn : [parent],
      );
      return { ...step, dependsOn: [...new Set(inherited)].filter((parent) => parent !== step.id) };
    });
}

export function removeStep(steps: readonly WorkflowStep[], id: string): WorkflowStep[] {
  return without(steps, id);
}

export function canMove(
  steps: readonly WorkflowStep[],
  id: string,
  direction: MoveDirection,
): boolean {
  const stages = workflowStages(steps);
  const stage = stages.findIndex((members) => members.includes(id));
  if (stage < 0) return false;
  if (direction === 'earlier') return stage > 0;
  return (stages[stage]?.length ?? 0) > 1 || stage < stages.length - 1;
}

function withParents(
  steps: readonly WorkflowStep[],
  id: string,
  dependsOn: readonly string[],
): WorkflowStep[] {
  return steps.map((step) => (step.id === id ? { ...step, dependsOn: [...dependsOn] } : step));
}

export function moveStep(
  steps: readonly WorkflowStep[],
  id: string,
  direction: MoveDirection,
): WorkflowStep[] {
  if (!canMove(steps, id, direction)) return [...steps];
  const stages = workflowStages(steps);
  const stage = stages.findIndex((members) => members.includes(id));
  if (direction === 'earlier') {
    return withParents(steps, id, stage > 1 ? (stages[stage - 2] ?? []) : []);
  }
  const moved = steps.find((step) => step.id === id)!;
  const rest = without(steps, id);
  const after = workflowStages(rest)[stage] ?? [];
  const index = steps.indexOf(moved);
  const placed = { ...moved, dependsOn: [...after] };
  return [...rest.slice(0, index), placed, ...rest.slice(index)];
}

export function toggleParent(
  steps: readonly WorkflowStep[],
  id: string,
  parent: string,
): WorkflowStep[] {
  return steps.map((step) => {
    if (step.id !== id) return step;
    const dependsOn = step.dependsOn.includes(parent)
      ? step.dependsOn.filter((existing) => existing !== parent)
      : [...step.dependsOn, parent];
    return { ...step, dependsOn };
  });
}

export function updateStep(
  steps: readonly WorkflowStep[],
  id: string,
  change: Partial<Pick<WorkflowStep, 'prompt' | 'join' | 'onFailure'>>,
): WorkflowStep[] {
  return steps.map((step) => (step.id === id ? { ...step, ...change } : step));
}

export function retargetStep(
  steps: readonly WorkflowStep[],
  id: string,
  target: StepTarget,
): WorkflowStep[] {
  return steps.map((step) => {
    if (step.id !== id) return step;
    const { id: stepId, prompt, dependsOn, join, onFailure } = step;
    return { id: stepId, ...targetFields(target), prompt, dependsOn, join, onFailure };
  });
}

export interface StagePreviewStep {
  stepId: string;
  sparkId: string | null;
  workflowId: string | null;
}

export function stagePreview(
  steps: readonly (Pick<WorkflowStep, 'id' | 'dependsOn'> & Targeted)[],
): StagePreviewStep[][] {
  const stepOf = new Map(steps.map((step) => [step.id, step]));
  return workflowStages(steps).map((stage) =>
    stage.map((stepId) => ({
      stepId,
      sparkId: stepOf.get(stepId)?.sparkId ?? null,
      workflowId: stepOf.get(stepId)?.workflowId ?? null,
    })),
  );
}

function targetName(
  step: Targeted,
  sparks: ReadonlyMap<string, string>,
  workflows: ReadonlyMap<string, string>,
): string {
  if (step.workflowId !== undefined) return workflows.get(step.workflowId) ?? 'Missing workflow';
  return sparks.get(step.sparkId ?? '') ?? 'Missing Spark';
}

export type NamesInside = (path: readonly string[]) => string[];

interface NamedSteps {
  name: string;
  steps: readonly (Pick<WorkflowStep, 'id'> & Targeted)[];
}

export function namesInside(
  workflow: NamedSteps | null,
  find: (id: string) => NamedSteps | null,
): NamesInside {
  return (path) => {
    let current = workflow;
    return path.map((segment) => {
      const used = current?.steps.find((step) => step.id === segment)?.workflowId;
      current = used === undefined ? null : find(used);
      return current?.name ?? segment;
    });
  };
}

export function stepLabels(
  steps: readonly (Pick<WorkflowStep, 'id'> & Targeted)[],
  sparks: readonly SparkName[],
  workflows: readonly SparkName[] = [],
  inside: NamesInside = (path) => [...path],
): Map<string, string> {
  const sparkNames = new Map(sparks.map((spark) => [spark.id, spark.name]));
  const workflowNames = new Map(workflows.map((workflow) => [workflow.id, workflow.name]));
  const named = steps.map((step) => {
    const path = inside(step.id.split('.').slice(0, -1));
    const name = targetName(step, sparkNames, workflowNames);
    return { id: step.id, name: [...path, name].join(' › ') };
  });
  const uses = new Map<string, number>();
  for (const { name } of named) uses.set(name, (uses.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const { id, name } of named) {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    labels.set(id, (uses.get(name) ?? 0) > 1 ? `${name} (${count})` : name);
  }
  return labels;
}

export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function afterLabel(
  steps: readonly WorkflowStep[],
  id: string,
  labels: ReadonlyMap<string, string>,
): string {
  const step = steps.find((candidate) => candidate.id === id);
  const parents = [...new Set(step?.dependsOn ?? [])].filter((parent) => labels.has(parent));
  if (!step || parents.length === 0) return 'Starts first';
  if (parents.length === 1) return `After ${labels.get(parents[0]!)}`;
  const stages = workflowStages(steps);
  const stage = stages.findIndex((members) => members.includes(parents[0]!));
  const members = stages[stage] ?? [];
  const wholeStage =
    members.length === parents.length && members.every((member) => parents.includes(member));
  const quantity = step.join === 'any' ? 'any' : 'all';
  if (wholeStage) return `After ${quantity} of Stage ${stage + 1}`;
  const names = parents.map((parent) => labels.get(parent)!);
  return step.join === 'any' ? `After any of ${listed(names)}` : `After ${listed(names)}`;
}

export function dependencyChanges(
  before: readonly WorkflowStep[],
  after: readonly WorkflowStep[],
  labels: ReadonlyMap<string, string>,
): string[] {
  const old = new Map(before.map((step) => [step.id, step]));
  return after.flatMap((step) => {
    const was = old.get(step.id);
    if (!was) return [];
    const earlier = afterLabel(before, step.id, labels);
    const now = afterLabel(after, step.id, labels);
    const sameParents =
      was.dependsOn.length === step.dependsOn.length &&
      was.dependsOn.every((parent) => step.dependsOn.includes(parent));
    if (sameParents || earlier === now) return [];
    return [`${labels.get(step.id) ?? step.id}: ${now} · was ${earlier}`];
  });
}
