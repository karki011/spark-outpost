import type { ProjectMap } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import type { BuildStages } from './build-stages.ts';
import { BuildCard } from './BuildStages.tsx';

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

export function buildProgress(maps: readonly ProjectMap[]): { done: number; total: number } {
  return maps.reduce(
    (sum, map) => ({
      done: sum.done + (map.status?.progress.done ?? 0),
      total: sum.total + (map.status?.progress.total ?? 0),
    }),
    { done: 0, total: 0 },
  );
}

interface SparkSayProps {
  maps: readonly ProjectMap[];
  phase: BuildPhase;
  build: BuildStages;
  revealed: { shown: number; total: number; last: string | null } | null;
}

export function SparkSay({ maps, phase, build, revealed }: SparkSayProps) {
  const empty = phase === 'ready' && maps.every((map) => map.areas.length === 0);
  if (empty) {
    return (
      <div className="map-say map-glass" role="status" data-map-overlay>
        <BlobScout size={34} mood="sleep" />
        <p>There is nothing to map here yet. Spark found no source files it could read.</p>
      </div>
    );
  }
  if (revealed && revealed.shown >= revealed.total) {
    return (
      <div className="map-say map-glass" role="status" data-map-overlay>
        <BlobScout size={34} mood="happy" />
        <p>All {revealed.total} areas are on the map. Click a gold name to look inside.</p>
      </div>
    );
  }
  if (revealed) {
    return (
      <div className="map-say map-glass" role="status" data-map-overlay>
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
  return <BuildCard build={build} />;
}
