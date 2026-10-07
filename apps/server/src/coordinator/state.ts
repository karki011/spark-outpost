import type { PieceList } from '@spark-outpost/contracts';
import type { OwnedSet } from './owned.ts';

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
  crossed: Set<string>;
  integrated: boolean;
  integrator: string | null;
  base: string | null;
  unhealthy: Map<string, string>;
  sharedBase?: SharedBase;
  topTier?: ReadonlySet<string>;
}
