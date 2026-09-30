import type { ProjectMap } from '@spark-outpost/contracts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { stageCount, stageSentence, type BuildStages, type Stage } from './build-stages.ts';
import { buildPhase } from './BuildStatus.tsx';

interface MapStatusPillProps {
  maps: readonly ProjectMap[];
  build: BuildStages;
}

interface PillView {
  label: string;
  detail: string;
  ring: number | null;
  mood: ScoutMood;
  tone: 'quiet' | 'busy' | 'bad';
}

const SHORT: Record<Stage['id'], string> = {
  read: 'Reading files',
  trace: 'Tracing imports',
  label: 'Labelling',
  link: 'Linking',
};
const RING_R = 6.5;
const RING_C = 2 * Math.PI * RING_R;

function latestBuilt(maps: readonly ProjectMap[]): string | null {
  const dates = maps.map((map) => map.status?.builtAt).filter((date) => typeof date === 'string');
  return dates.sort().at(-1) ?? null;
}

function busyLabel(stage: Stage): string {
  const name = stage.jev ? 'Jev labelling' : SHORT[stage.id];
  const count = stageCount(stage)?.replace(' / ', '/');
  return count ? `${name}… ${count}` : `${name}…`;
}

function pillView(maps: readonly ProjectMap[], build: BuildStages, now: number): PillView {
  const phase = buildPhase(maps);
  const built = latestBuilt(maps);
  const since = built ? relativeTime(built, now) : null;
  if (phase === 'failed') {
    const error = maps.find((map) => map.status?.status === 'failed')?.status?.error;
    return {
      label: 'Map failed',
      detail: error ?? 'The map could not be built.',
      ring: null,
      mood: 'sad',
      tone: 'bad',
    };
  }
  if (build.paused) {
    return {
      label: 'Paused',
      detail: stageSentence(build),
      ring: null,
      mood: 'sleep',
      tone: 'quiet',
    };
  }
  if (build.waiting) {
    return {
      label: 'Waiting',
      detail: 'Waiting to build the map. Maps build in the background.',
      ring: null,
      mood: 'sleep',
      tone: 'quiet',
    };
  }
  if (phase === 'ready' || !build.active) {
    return {
      label: since ? `Updated ${since}` : 'Up to date',
      detail: 'The map is up to date. Spark refreshes it after new commits.',
      ring: null,
      mood: null,
      tone: 'quiet',
    };
  }
  const step = build.stages.indexOf(build.active) + 1;
  const context = phase === 'updating' && since ? ` Last built ${since}.` : '';
  return {
    label: busyLabel(build.active),
    detail: `${stageSentence(build)} Step ${step} of ${build.stages.length}.${context}`,
    ring: build.share,
    mood: 'working',
    tone: 'busy',
  };
}

function Ring({ share }: { share: number }) {
  return (
    <svg className="map-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={RING_R} className="map-ring-track" />
      <circle
        cx="8"
        cy="8"
        r={RING_R}
        className="map-ring-fill"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - share)}
      />
    </svg>
  );
}

export function MapStatusPill({ maps, build }: MapStatusPillProps) {
  const now = useMinuteClock();
  const view = pillView(maps, build, now);
  const { triggerProps, tooltip, show } = useTooltip(view.detail);
  if (maps.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className={`map-pill ${view.tone}`}
        {...triggerProps}
        onClick={(event) => show(event.currentTarget)}
      >
        {view.ring === null ? <BlobScout size={18} mood={view.mood} /> : <Ring share={view.ring} />}
        <span className="map-pill-text">{view.label}</span>
      </button>
      <span className="sr-only" role="status">
        {view.tone === 'bad' ? 'The map could not be built.' : stageSentence(build)}
      </span>
      {tooltip}
    </>
  );
}
