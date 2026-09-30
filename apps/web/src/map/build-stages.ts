import type { ProjectMap } from '@spark-outpost/contracts';

export type StageId = 'read' | 'trace' | 'label' | 'link';
export type StageState = 'done' | 'active' | 'next' | 'asleep';

export interface Stage {
  id: StageId;
  name: string;
  state: StageState;
  doing: string;
  progress: { done: number; total: number } | null;
  jev: boolean;
}

export interface BuildStages {
  stages: Stage[];
  paused: boolean;
  waiting: boolean;
  active: Stage | null;
  share: number;
}

type Status = NonNullable<ProjectMap['status']>;

const PHASE_ORDER: Record<Status['phase'], number> = {
  index: 0,
  graph: 1,
  labels: 2,
  links: 3,
  done: 4,
};

function fmt(value: number): string {
  return value.toLocaleString('en-US');
}

export function stageShare(stage: Stage): number | null {
  if (!stage.progress || stage.progress.total <= 0) return null;
  return Math.min(1, stage.progress.done / stage.progress.total);
}

export function stageCount(stage: Stage): string | null {
  if (!stage.progress || stage.progress.total <= 0) return null;
  return `${fmt(stage.progress.done)} / ${fmt(stage.progress.total)}`;
}

function position(status: Status | null): number {
  if (!status || status.status === 'queued') return -1;
  if (status.status === 'ready') return PHASE_ORDER.done;
  return PHASE_ORDER[status.phase];
}

function trailing(maps: readonly ProjectMap[]): Status | null {
  const statuses = maps.map((map) => map.status);
  const unfinished = statuses.filter((status) => status?.status !== 'ready');
  if (unfinished.length === 0) return statuses.find((status) => status !== null) ?? null;
  return unfinished.reduce<Status | null>(
    (least, status) => (least === null || position(status) < position(least) ? status : least),
    unfinished[0] ?? null,
  );
}

function labelStage(status: Status | null, at: number): Omit<Stage, 'state'> {
  const base = { id: 'label' as const, name: 'Jev', progress: null, jev: false };
  if (!status || at !== PHASE_ORDER.labels) {
    return { ...base, doing: 'Labelling areas' };
  }
  const progress = status.progress;
  const jevAreas = status.jevAreas;
  if (progress.total === 0) return { ...base, doing: 'Checking area labels' };
  if (jevAreas === 0) {
    return { ...base, doing: 'Jev not connected, labelling with rules', progress };
  }
  if (jevAreas !== null && progress.done < jevAreas) {
    return {
      ...base,
      doing: 'Jev is labelling areas',
      progress: { done: progress.done, total: jevAreas },
      jev: true,
    };
  }
  return { ...base, doing: 'Labelling the rest with rules', progress };
}

function stageState(index: number, at: number, paused: boolean): StageState {
  if (index < at) return 'done';
  if (paused) return 'asleep';
  return index === at ? 'active' : 'next';
}

export function buildStages(maps: readonly ProjectMap[], combined: boolean): BuildStages {
  const status = trailing(maps);
  const paused = maps.some((map) => map.status?.status === 'paused');
  const at = position(status);
  const progress = status?.progress ?? { done: 0, total: 0 };
  const counted = (index: number) => ({
    progress: at === index && progress.total > 0 ? progress : null,
  });
  const drafts: Omit<Stage, 'state'>[] = [
    { id: 'read', name: 'Reader', doing: 'Reading files', jev: false, ...counted(0) },
    {
      id: 'trace',
      name: 'Tracer',
      doing: 'Tracing imports and grouping areas',
      jev: false,
      progress: null,
    },
    labelStage(status, at),
  ];
  if (combined || at === PHASE_ORDER.links) {
    drafts.push({
      id: 'link',
      name: 'Linker',
      doing: 'Linking projects',
      jev: false,
      ...counted(3),
    });
  }
  const stages = drafts.map((draft, index) => {
    const state = stageState(index, at, paused);
    const jevAsleep = draft.id === 'label' && status?.jevAreas === 0 && at >= PHASE_ORDER.labels;
    return { ...draft, state: jevAsleep && state === 'active' ? 'asleep' : state };
  });
  const active = at >= 0 ? (stages[at] ?? null) : null;
  const doneCount = stages.filter((stage) => stage.state === 'done').length;
  const share = Math.min(1, (doneCount + (active ? (stageShare(active) ?? 0) : 0)) / stages.length);
  return { stages, paused, waiting: at < 0, active, share };
}

export function stageSentence(stages: BuildStages): string {
  if (stages.paused) return 'Paused while agents run. The map picks up when they finish.';
  if (stages.waiting) return 'Waiting to build the map.';
  if (!stages.active) return 'The map is up to date.';
  return `${stages.active.doing}.`;
}

export interface EtaSample {
  key: string;
  at: number;
  done: number;
}

const MIN_ETA_WINDOW_MS = 8_000;

export function estimateLeft(
  sample: EtaSample,
  now: number,
  done: number,
  total: number,
): string | null {
  const elapsed = now - sample.at;
  const moved = done - sample.done;
  if (elapsed < MIN_ETA_WINDOW_MS || moved <= 0 || total <= done) return null;
  const minutes = ((total - done) * elapsed) / moved / 60_000;
  if (minutes < 1) return 'less than a minute left';
  return `about ${Math.round(minutes)} min left`;
}
