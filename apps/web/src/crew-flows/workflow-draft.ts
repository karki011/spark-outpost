import {
  SCHEDULE_EVERY_MAX,
  TRIGGER_DEBOUNCE_MAX,
  type SaveWorkflow,
  type WorkflowSchedule,
  type WorkflowStep,
  type WorkflowTriggers,
} from '@spark-outpost/contracts';
import { defaultSchedule, windowed } from './schedule-model.ts';
import { branchProblem, defaultTriggers } from './triggers-model.ts';
import { listed } from './workflow-model.ts';

export type ScheduleDraft = Omit<WorkflowSchedule, 'every'> & { every: string };
export type TriggersDraft = Omit<WorkflowTriggers, 'debounceMinutes'> & {
  debounceMinutes: string;
};

export interface WorkflowDraft {
  name: string;
  steps: WorkflowStep[];
  schedule: ScheduleDraft;
  triggers: TriggersDraft;
}

export interface DraftBaseline {
  file: Pick<WorkflowDraft, 'name' | 'steps'> | null;
  schedule: ScheduleDraft;
  triggers: TriggersDraft;
}

export const ANY_PROJECT = 'any';
export const MIXED_PROJECTS = 'mixed';

function whole(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

export function toSchedule(draft: ScheduleDraft): WorkflowSchedule {
  return { ...draft, every: whole(draft.every) ?? 0 };
}

export function toTriggers(draft: TriggersDraft): WorkflowTriggers {
  return {
    ...draft,
    branchGlob: draft.branchGlob.trim(),
    debounceMinutes: whole(draft.debounceMinutes) ?? 0,
  };
}

export function baselineOf(
  file: DraftBaseline['file'],
  schedule: WorkflowSchedule | null,
  triggers: WorkflowTriggers | null,
  today: Date,
): DraftBaseline {
  const storedSchedule = schedule ?? defaultSchedule(today);
  const storedTriggers = triggers ?? defaultTriggers();
  return {
    file,
    schedule: { ...storedSchedule, every: String(storedSchedule.every) },
    triggers: { ...storedTriggers, debounceMinutes: String(storedTriggers.debounceMinutes) },
  };
}

export function draftOf(
  baseline: DraftBaseline,
  fresh: Pick<WorkflowDraft, 'name' | 'steps'>,
): WorkflowDraft {
  const file = baseline.file ?? fresh;
  return {
    name: file.name,
    steps: file.steps,
    schedule: baseline.schedule,
    triggers: baseline.triggers,
  };
}

export type DraftField = 'name' | 'steps' | 'every' | 'hours' | 'wait' | 'branch';
export type DraftTab = 'steps' | 'when';

export interface DraftProblem {
  field: DraftField;
  tab: DraftTab;
  text: string;
}

function plural(total: number, word: string): string {
  return `${total} ${word}${total === 1 ? '' : 's'}`;
}

export function draftProblems(draft: WorkflowDraft, stepProblems: number): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const add = (field: DraftField, tab: DraftTab, text: string) =>
    problems.push({ field, tab, text });
  if (draft.name.trim() === '') add('name', 'steps', 'Give the workflow a name.');
  if (draft.steps.length === 0) add('steps', 'steps', 'Add a step to start.');
  else if (stepProblems > 0) {
    add('steps', 'steps', `Fix ${plural(stepProblems, 'problem')} to save.`);
  }

  const every = whole(draft.schedule.every);
  if (every === null || every < 1 || every > SCHEDULE_EVERY_MAX) {
    add('every', 'when', `Every takes a whole number from 1 to ${SCHEDULE_EVERY_MAX}.`);
  }
  const { unit, from, to } = draft.schedule;
  if (windowed(unit) && to !== null && to <= from) {
    add('hours', 'when', 'The end of the hours must be after the start.');
  }
  const wait = whole(draft.triggers.debounceMinutes);
  if (wait === null || wait > TRIGGER_DEBOUNCE_MAX) {
    add('wait', 'when', `Wait takes a whole number of minutes from 0 to ${TRIGGER_DEBOUNCE_MAX}.`);
  }
  const branch = draft.triggers.commit ? branchProblem(draft.triggers.branchGlob) : null;
  if (branch !== null) add('branch', 'when', branch);
  return problems;
}

export function problemOf(problems: readonly DraftProblem[], field: DraftField): string | null {
  return problems.find((problem) => problem.field === field)?.text ?? null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface DirtyParts {
  steps: boolean;
  schedule: boolean;
  triggers: boolean;
}

export function dirtyParts(baseline: DraftBaseline, draft: WorkflowDraft): DirtyParts {
  return {
    steps: !same(baseline.file, { name: draft.name, steps: draft.steps }),
    schedule: !same(baseline.schedule, draft.schedule),
    triggers: !same(baseline.triggers, draft.triggers),
  };
}

function changedSteps(before: readonly WorkflowStep[], after: readonly WorkflowStep[]): number {
  const old = new Map(before.map((step) => [step.id, step]));
  const kept = after.filter((step) => old.has(step.id));
  const edited = kept.filter((step) => !same(step, old.get(step.id))).length;
  const total = edited + (after.length - kept.length) + (before.length - kept.length);
  return total === 0 && !same(before, after) ? 1 : total;
}

function changedKeys<T extends object>(before: T, after: T, skip: readonly (keyof T)[]): number {
  const keys = (Object.keys(after) as (keyof T)[]).filter((key) => !skip.includes(key));
  return keys.filter((key) => !same(before[key], after[key])).length;
}

export function unsavedChanges(baseline: DraftBaseline, draft: WorkflowDraft): number {
  const dirty = dirtyParts(baseline, draft);
  const file = baseline.file;
  const steps = !dirty.steps
    ? 0
    : file === null
      ? 1
      : (file.name === draft.name ? 0 : 1) + changedSteps(file.steps, draft.steps);
  const schedule = dirty.schedule
    ? Math.max(1, changedKeys(baseline.schedule, draft.schedule, ['anchor']))
    : 0;
  const triggers = dirty.triggers
    ? Math.max(1, changedKeys(baseline.triggers, draft.triggers, []))
    : 0;
  const oneWhere =
    baseline.schedule.projectId !== draft.schedule.projectId &&
    baseline.triggers.projectId !== draft.triggers.projectId;
  return steps + schedule + triggers - (oneWhere ? 1 : 0);
}

export function whereValue(draft: WorkflowDraft): string {
  const { projectId } = draft.schedule;
  if (projectId !== draft.triggers.projectId) return MIXED_PROJECTS;
  return projectId ?? ANY_PROJECT;
}

export function setWhere(draft: WorkflowDraft, projectId: string | null): WorkflowDraft {
  return {
    ...draft,
    schedule: { ...draft.schedule, projectId },
    triggers: { ...draft.triggers, projectId },
  };
}

export type SavePart = keyof DirtyParts;

export interface SaveApi {
  workflow: (input: SaveWorkflow) => Promise<{ hash: string }>;
  schedule: (schedule: WorkflowSchedule) => Promise<unknown>;
  triggers: (triggers: WorkflowTriggers) => Promise<unknown>;
}

export interface SaveOutcome {
  hash: string | null;
  baseline: DraftBaseline;
  saved: SavePart[];
  failed: { part: SavePart; message: string }[];
  skipped: SavePart[];
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'It didn’t save.');

export async function saveDraft(
  id: string,
  draft: WorkflowDraft,
  baseline: DraftBaseline,
  hash: string | null,
  api: SaveApi,
): Promise<SaveOutcome> {
  const dirty = dirtyParts(baseline, draft);
  const outcome: SaveOutcome = { hash, baseline, saved: [], failed: [], skipped: [] };
  const later = (['schedule', 'triggers'] as const).filter((part) => dirty[part]);
  if (dirty.steps) {
    try {
      const workflow = { id, name: draft.name.trim(), steps: draft.steps };
      outcome.hash = (await api.workflow({ workflow, baseHash: hash })).hash;
      outcome.baseline = { ...outcome.baseline, file: { name: draft.name, steps: draft.steps } };
      outcome.saved.push('steps');
    } catch (error) {
      outcome.failed.push({ part: 'steps', message: reasonOf(error) });
      outcome.skipped.push(...later);
      return outcome;
    }
  }
  const writes = {
    schedule: () => api.schedule(toSchedule(draft.schedule)),
    triggers: () => api.triggers(toTriggers(draft.triggers)),
  };
  for (const part of later) {
    try {
      await writes[part]();
      outcome.baseline = { ...outcome.baseline, [part]: draft[part] };
      outcome.saved.push(part);
    } catch (error) {
      outcome.failed.push({ part, message: reasonOf(error) });
    }
  }
  return outcome;
}

const PART_WORDS: Record<SavePart, string> = {
  steps: 'the steps',
  schedule: 'the schedule',
  triggers: 'the triggers',
};

function sentence(text: string): string {
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

function partsLine(parts: readonly SavePart[], one: string, many: string): string[] {
  if (parts.length === 0) return [];
  const names = listed(parts.map((part) => PART_WORDS[part]));
  return [sentence(`${names} ${parts.length === 1 ? one : many}`)];
}

export function saveFailureText(outcome: SaveOutcome): string | null {
  if (outcome.failed.length === 0) return null;
  return [
    ...outcome.failed.map(({ part, message }) =>
      sentence(`${PART_WORDS[part]} didn’t save: ${message}`),
    ),
    ...partsLine(outcome.skipped, 'was not tried', 'were not tried'),
    ...partsLine(outcome.saved, 'is saved', 'are saved'),
    'Your changes are still here.',
  ].join(' ');
}
