import type { WorkflowPreview, WorkflowStep, WorkflowStepState } from '@spark-outpost/contracts';
import { listed } from './workflow-model.ts';

export interface PreviewResult {
  headline: string;
  lines: string[];
  stoppedBy: string | null;
}

export function statesAt(
  preview: WorkflowPreview,
  position: number,
): Record<string, WorkflowStepState> {
  if (position >= preview.rounds.length) return { ...preview.states };
  const ran = new Set(preview.rounds.slice(0, position).flat());
  return Object.fromEntries(
    Object.entries(preview.states).map(([id, state]) => [id, ran.has(id) ? state : 'waiting']),
  );
}

export function positionLabel(preview: WorkflowPreview, position: number): string {
  const total = preview.rounds.length;
  if (position <= 0) return `Before the start · ${total} ${total === 1 ? 'round' : 'rounds'}`;
  return `Round ${Math.min(position, total)} of ${total}`;
}

function have(count: number): string {
  return count === 1 ? "doesn't" : "don't";
}

export function previewResult(
  steps: readonly WorkflowStep[],
  preview: WorkflowPreview,
  labels: ReadonlyMap<string, string>,
): PreviewResult {
  const name = (id: string) => labels.get(id) ?? id;
  const ids = steps.map((step) => step.id);
  const failed = ids.filter((id) => preview.states[id] === 'failed');
  const skipped = ids.filter((id) => preview.states[id] === 'skipped');
  const total = preview.rounds.length;

  if (preview.stoppedBy === null && failed.length === 0) {
    return {
      headline: 'Every step runs.',
      lines: [
        `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} in ${total} ${total === 1 ? 'round' : 'rounds'}.`,
      ],
      stoppedBy: null,
    };
  }

  const lines: string[] = [];
  const carried = failed.filter((id) => id !== preview.stoppedBy);
  if (carried.length > 0) {
    lines.push(
      `${listed(carried.map(name))} ${carried.length === 1 ? 'fails and is' : 'fail and are'} set to Continue, so the steps after still run and get the note.`,
    );
  }

  if (preview.stoppedBy === null) {
    return { headline: 'The workflow keeps going.', lines, stoppedBy: null };
  }

  const stopper = preview.stoppedBy;
  const round = preview.rounds.findIndex((members) => members.includes(stopper));
  const alongside = (preview.rounds[round] ?? []).filter(
    (id) => id !== stopper && preview.states[id] === 'succeeded',
  );
  lines.unshift(`${name(stopper)} is set to Stop workflow when it fails.`);
  if (skipped.length > 0) lines.push(`${listed(skipped.map(name))} ${have(skipped.length)} start.`);
  if (alongside.length > 0) {
    lines.push(
      `${listed(alongside.map(name))} still ${alongside.length === 1 ? 'finishes and keeps its' : 'finish and keep their'} output.`,
    );
  }
  return { headline: `The workflow stops at round ${round + 1}.`, lines, stoppedBy: stopper };
}
