import type { ProjectMap } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';

export type BuildPhase = 'waiting' | 'first' | 'updating' | 'ready' | 'failed';

export function buildPhase(maps: readonly ProjectMap[]): BuildPhase {
  if (maps.some((map) => map.status?.status === 'failed')) return 'failed';
  if (maps.some((map) => map.areas.length === 0 && map.status?.status !== 'ready')) {
    return maps.some((map) => map.status && map.status.status !== 'queued') ? 'first' : 'waiting';
  }
  if (maps.some((map) => map.status?.status === 'building' || map.status?.status === 'queued')) {
    return 'updating';
  }
  return 'ready';
}

const STEP_TEXT = {
  index: 'Reading files',
  graph: 'Following imports',
  labels: 'Asking Jev to name areas',
  links: 'Linking projects',
  done: 'Finishing',
} as const;

function isPaused(maps: readonly ProjectMap[]): boolean {
  return maps.some((map) => map.status?.status === 'paused');
}

export function buildProgress(maps: readonly ProjectMap[]): { done: number; total: number } {
  return maps.reduce(
    (sum, map) => ({
      done: sum.done + (map.status?.progress.done ?? 0),
      total: sum.total + (map.status?.progress.total ?? 0),
    }),
    { done: 0, total: 0 },
  );
}

function latestBuilt(maps: readonly ProjectMap[]): string | null {
  const dates = maps.map((map) => map.status?.builtAt).filter((date) => typeof date === 'string');
  return dates.sort().at(-1) ?? null;
}

export function MapStatusLine({ maps }: { maps: readonly ProjectMap[] }) {
  const now = useMinuteClock();
  const phase = buildPhase(maps);
  const built = latestBuilt(maps);
  const failed = maps.find((map) => map.status?.status === 'failed')?.status?.error;
  if (isPaused(maps) && phase !== 'failed') {
    return (
      <span className="map-status" role="status">
        <BlobScout size={18} mood="sleep" />
        <span>Paused while agents run</span>
      </span>
    );
  }
  return (
    <span className="map-status" role="status">
      <BlobScout
        size={18}
        mood={phase === 'failed' ? 'sad' : phase === 'ready' ? null : 'working'}
      />
      {phase === 'waiting' && <span>Waiting to build the map</span>}
      {phase === 'first' && (
        <span>
          <b>Building the map</b>
          <span className="map-long"> · first time for this project</span>
        </span>
      )}
      {phase === 'failed' && <span title={failed ?? undefined}>The map could not be built</span>}
      {(phase === 'ready' || phase === 'updating') && (
        <span>
          Map built <b>{built ? relativeTime(built, now) : 'earlier'}</b>
          {phase === 'updating' && <span className="map-long"> · updating</span>}
        </span>
      )}
    </span>
  );
}

interface SparkSayProps {
  maps: readonly ProjectMap[];
  phase: BuildPhase;
  progress: { done: number; total: number };
  revealed: { shown: number; total: number; last: string | null } | null;
}

export function SparkSay({ maps, phase, progress, revealed }: SparkSayProps) {
  if (revealed && revealed.shown >= revealed.total) {
    return (
      <div className="map-say map-glass" role="status">
        <BlobScout size={34} mood="happy" />
        <p>All {revealed.total} areas are on the map. Click a gold name to look inside.</p>
      </div>
    );
  }
  if (revealed) {
    return (
      <div className="map-say map-glass" role="status">
        <BlobScout size={34} mood="working" />
        <div>
          <p>
            Charted <b>{revealed.last}</b>. The rest are on their way.
          </p>
          <small>
            {revealed.shown} of {revealed.total} areas
          </small>
          <div className="map-pbar">
            <i style={{ width: `${(revealed.shown / revealed.total) * 100}%` }} />
          </div>
        </div>
      </div>
    );
  }
  if (phase !== 'first' && phase !== 'waiting') return null;
  const share = progress.total > 0 ? progress.done / progress.total : 0;
  const paused = isPaused(maps);
  const step = maps.find((map) => map.status && map.status.status !== 'ready')?.status?.phase;
  const message = paused
    ? 'Paused while agents run. I’ll pick up where I left off.'
    : phase === 'waiting'
      ? 'Your project is in line for its first map.'
      : 'I’m reading your project and sorting it into areas. Each one lights up when it’s done.';
  return (
    <div className="map-say map-glass" role="status">
      <BlobScout size={34} mood={paused ? 'sleep' : 'working'} />
      <div>
        <p>{message}</p>
        {progress.total > 0 && (
          <small>
            {step ? `${STEP_TEXT[step]} · ` : ''}
            {progress.done.toLocaleString('en-US')} of {progress.total.toLocaleString('en-US')}{' '}
            files
          </small>
        )}
        <div className="map-pbar">
          <i style={{ width: `${share * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
