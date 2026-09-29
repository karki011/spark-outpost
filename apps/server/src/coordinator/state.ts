import type { PieceList } from '@spark-outpost/contracts';
import type { OwnedSet } from './owned.ts';

export interface Coordination {
  list: PieceList | null;
  fallback: string | null;
  owned: ReadonlyMap<string, OwnedSet>;
  names: ReadonlyMap<string, string>;
  scoutNotes: string[];
  violations: number;
  integrated: boolean;
  integrator: string | null;
  base: string | null;
}
