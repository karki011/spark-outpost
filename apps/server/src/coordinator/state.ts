import type { PieceList } from '@spark-outpost/contracts';
import type { OwnedSet } from './owned.ts';

export interface Renumbered {
  piece: string;
  from: string;
  to: string;
}

export interface Conflict {
  piece: string;
  files: string[];
  resolvedBy: 'integrator' | 'you' | null;
}

export interface SharedBase {
  root: string;
  commit: string;
}

export interface Coordination {
  list: PieceList | null;
  fallback: string | null;
  owned: ReadonlyMap<string, OwnedSet>;
  builderEnv: Record<string, string> | null;
  names: ReadonlyMap<string, string>;
  scoutNotes: string[];
  violations: number;
  integrated: boolean;
  integrator: string | null;
  base: string | null;
  unhealthy: Map<string, string>;
  sharedBase?: SharedBase;
  renumbered?: Renumbered[];
  conflicts?: Conflict[];
}
