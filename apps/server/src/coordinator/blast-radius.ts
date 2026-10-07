import { mapRootFor } from '../map/impact.ts';
import { fileNeighbors } from '../map/neighbors.ts';
import type { Queryable } from '../persistence/db.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { factPaths } from './piece-facts.ts';

export interface BlastRadius {
  path: string;
  dependents: string[];
  dependentsTotal: number;
  coreAreas: string[];
}

const DIRECT_HOPS = 1;

async function radiusOf(db: Queryable, mapRoot: string, path: string): Promise<BlastRadius | null> {
  const found = await fileNeighbors(db, mapRoot, path, DIRECT_HOPS);
  if (!found || found.impact.direct === 0) return null;
  return {
    path,
    dependents: found.importedBy
      .map((neighbor) => neighbor.path)
      .filter((dependent) => !isSecretPath(dependent)),
    dependentsTotal: found.impact.direct,
    coreAreas: found.impact.coreAreas.map((area) => area.name),
  };
}

export async function blastRadius(
  db: Queryable,
  root: string,
  paths: readonly string[],
): Promise<BlastRadius[]> {
  const wanted = factPaths(paths);
  if (wanted.length === 0) return [];
  const mapRoot = await mapRootFor(db, root);
  const found = await Promise.all(wanted.map((path) => radiusOf(db, mapRoot, path)));
  return found.filter((radius) => radius !== null);
}

export function blastRadiusLine(radius: BlastRadius): string {
  const more = radius.dependentsTotal - radius.dependents.length;
  const dependents = `${radius.path} is imported by ${radius.dependentsTotal}: ${radius.dependents.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  return radius.coreAreas.length > 0
    ? `${dependents}. Core areas that depend on it: ${radius.coreAreas.join(', ')}`
    : dependents;
}
