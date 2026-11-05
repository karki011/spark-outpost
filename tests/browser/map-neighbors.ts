import type { MapNeighbor, MapNeighbors } from '../../packages/contracts/src/map.ts';
import type { FixtureProject } from './map-fixture.ts';

function adjacency(edges: readonly [string, string][], reverse: boolean): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const [a, b] = reverse ? [to, from] : [from, to];
    next.set(a, [...(next.get(a) ?? []), b]);
  }
  return next;
}

function reach(next: Map<string, string[]>, start: string, hops: number): Map<string, number> {
  const found = new Map<string, number>();
  let frontier = [start];
  for (let hop = 1; hop <= hops && frontier.length > 0; hop += 1) {
    const step = [...new Set(frontier.flatMap((path) => next.get(path) ?? []))].filter(
      (path) => path !== start && !found.has(path),
    );
    for (const path of step) found.set(path, hop);
    frontier = step;
  }
  return found;
}

export function fixtureNeighbors(
  project: FixtureProject,
  path: string,
  hops: number,
): MapNeighbors | null {
  const areaOf = new Map<string, string>();
  const facts = new Map<string, { kind: MapNeighbor['kind']; importance: number; fanIn: number }>();
  for (const [areaId, files] of project.files) {
    for (const file of files) {
      areaOf.set(file.path, areaId);
      facts.set(file.path, file);
    }
  }
  const areaId = areaOf.get(path);
  if (!areaId) return null;
  const list = (found: Map<string, number>): MapNeighbor[] =>
    [...found]
      .map(([other, hop]) => ({
        path: other,
        areaId: areaOf.get(other) ?? areaId,
        kind: facts.get(other)?.kind ?? 'other',
        importance: facts.get(other)?.importance ?? 0,
        fanIn: facts.get(other)?.fanIn ?? 0,
        hop,
      }))
      .sort((a, b) => a.hop - b.hop || b.importance - a.importance)
      .slice(0, 200);
  const imports = reach(adjacency(project.edges, false), path, hops);
  const importedBy = reach(adjacency(project.edges, true), path, hops);
  const all = reach(adjacency(project.edges, true), path, Infinity);
  const perArea = new Map<string, number>();
  for (const other of all.keys()) {
    const area = areaOf.get(other);
    if (area) perArea.set(area, (perArea.get(area) ?? 0) + 1);
  }
  const coreAreas = project.areas
    .filter((area) => area.category === 'core' && perArea.has(area.id))
    .map((area) => ({ id: area.id, name: area.name, files: perArea.get(area.id)! }));
  return {
    path,
    areaId,
    hops,
    imports: list(imports),
    importedBy: list(importedBy),
    importsTotal: imports.size,
    importedByTotal: importedBy.size,
    impact: {
      direct: [...importedBy.values()].filter((hop) => hop === 1).length,
      total: all.size,
      areas: perArea.size,
      coreAreas,
    },
  };
}
