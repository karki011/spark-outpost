import type { MapArea } from '@spark-outpost/contracts';
import type { MapFilters } from '../frame.ts';
import type { MapGroup } from '../groups.ts';
import type { Scene, SceneArea, SceneFile } from '../scene.ts';

export type OutlineSort = 'importance' | 'name' | 'files' | 'recent';

interface RowBase {
  id: string;
  parent: string | null;
  level: number;
  setSize: number;
  posInSet: number;
}

export type OutlineRow = RowBase &
  (
    | { kind: 'project'; name: string; expanded: boolean; files: number }
    | {
        kind: 'group';
        group: MapGroup;
        areas: number;
        files: number;
        expanded: boolean;
        changed: number;
      }
    | { kind: 'area'; area: MapArea; key: string; expanded: boolean; changed: number }
    | { kind: 'file'; file: number; changed: boolean }
    | { kind: 'loading' }
  );

export interface OutlineSource {
  scene: Scene;
  groups: readonly MapGroup[];
  filters: MapFilters;
  changed: ReadonlySet<number>;
  changedAreas: ReadonlyMap<string, number>;
  projects: readonly { projectId: string; name: string }[];
}

interface Sortable {
  name: string;
  importance: number;
  size: number;
  changedAt: string | null;
}

function compare(sort: OutlineSort) {
  return (a: Sortable, b: Sortable): number => {
    const byName = a.name.localeCompare(b.name);
    if (sort === 'name') return byName;
    if (sort === 'files') return b.size - a.size || byName;
    if (sort === 'recent') {
      return (
        (b.changedAt ?? '').localeCompare(a.changedAt ?? '') ||
        b.importance - a.importance ||
        byName
      );
    }
    return b.importance - a.importance || byName;
  };
}

const areaSortable = (area: MapArea): Sortable => ({
  name: area.name,
  importance: area.importance,
  size: area.fileCount,
  changedAt: area.lastChangedAt,
});

const fileSortable = (file: SceneFile): Sortable => ({
  name: file.name,
  importance: file.importance,
  size: file.lines,
  changedAt: file.lastChangedAt,
});

type Unit = { group: MapGroup; areas: SceneArea[] } | { area: SceneArea };

function sortedBy<T>(items: readonly T[], key: (item: T) => Sortable, sort: OutlineSort): T[] {
  const order = compare(sort);
  return [...items].sort((a, b) => order(key(a), key(b)));
}

export function outlineRows(
  source: OutlineSource,
  expanded: ReadonlySet<string>,
  sort: OutlineSort,
): OutlineRow[] {
  const { scene, filters } = source;
  const rows: OutlineRow[] = [];
  const combined = source.projects.length > 1;

  const unitSortable = (unit: Unit): Sortable =>
    'area' in unit
      ? areaSortable(unit.area.area)
      : {
          name: unit.group.name,
          importance: unit.group.importance,
          size: unit.areas.reduce((sum, entry) => sum + entry.area.fileCount, 0),
          changedAt: unit.group.lastChangedAt,
        };

  const pushFiles = (entry: SceneArea, level: number) => {
    if (!entry.complete) {
      rows.push({
        kind: 'loading',
        id: `l:${entry.key}`,
        parent: entry.key,
        level,
        setSize: 1,
        posInSet: 1,
      });
      return;
    }
    const files = sortedBy(
      entry.files.filter((file) => filters.kinds.has(scene.files[file]!.kind)),
      (file) => fileSortable(scene.files[file]!),
      sort,
    );
    files.forEach((file, index) => {
      rows.push({
        kind: 'file',
        id: `f:${scene.files[file]!.key}`,
        parent: entry.key,
        level,
        setSize: files.length,
        posInSet: index + 1,
        file,
        changed: source.changed.has(file),
      });
    });
  };

  const pushArea = (
    entry: SceneArea,
    parent: string | null,
    level: number,
    setSize: number,
    posInSet: number,
  ) => {
    const open = expanded.has(entry.key);
    rows.push({
      kind: 'area',
      id: entry.key,
      parent,
      level,
      setSize,
      posInSet,
      area: entry.area,
      key: entry.key,
      expanded: open,
      changed: source.changedAreas.get(entry.key) ?? 0,
    });
    if (open) pushFiles(entry, level + 1);
  };

  const pushUnits = (projectId: string, parent: string | null, level: number) => {
    const units: Unit[] = source.groups
      .filter((group) => group.projectId === projectId)
      .map((group) => ({
        group,
        areas: group.areaKeys
          .map((key) => scene.areas[scene.areaByKey.get(key) ?? -1])
          .filter((entry) => entry !== undefined && filters.categories.has(entry.area.category)),
      }))
      .filter((unit) => unit.areas.length > 0)
      .map((unit): Unit => (unit.areas.length === 1 ? { area: unit.areas[0]! } : unit));
    const sorted = sortedBy(units, unitSortable, sort);
    sorted.forEach((unit, index) => {
      if ('area' in unit) {
        pushArea(unit.area, parent, level, sorted.length, index + 1);
        return;
      }
      const open = expanded.has(unit.group.id);
      rows.push({
        kind: 'group',
        id: unit.group.id,
        parent,
        level,
        setSize: sorted.length,
        posInSet: index + 1,
        group: unit.group,
        areas: unit.areas.length,
        files: unit.areas.reduce((sum, entry) => sum + entry.area.fileCount, 0),
        expanded: open,
        changed: unit.areas.reduce(
          (sum, entry) => sum + (source.changedAreas.get(entry.key) ?? 0),
          0,
        ),
      });
      if (!open) return;
      const areas = sortedBy(unit.areas, (entry) => areaSortable(entry.area), sort);
      areas.forEach((entry, position) =>
        pushArea(entry, unit.group.id, level + 1, areas.length, position + 1),
      );
    });
  };

  if (!combined) {
    for (const project of source.projects) pushUnits(project.projectId, null, 1);
    return rows;
  }
  source.projects.forEach((project, index) => {
    const id = `p:${project.projectId}`;
    const open = expanded.has(id);
    rows.push({
      kind: 'project',
      id,
      parent: null,
      level: 1,
      setSize: source.projects.length,
      posInSet: index + 1,
      name: project.name,
      expanded: open,
      files: scene.areas
        .filter((entry) => entry.projectId === project.projectId)
        .reduce((sum, entry) => sum + entry.area.fileCount, 0),
    });
    if (open) pushUnits(project.projectId, id, 2);
  });
  return rows;
}

export function outlineReveal(
  scene: Scene,
  groups: readonly MapGroup[],
  areaKey: string,
): string[] {
  const entry = scene.areas[scene.areaByKey.get(areaKey) ?? -1];
  const group = groups.find((candidate) => candidate.areaKeys.includes(areaKey));
  return [...(entry ? [`p:${entry.projectId}`] : []), ...(group ? [group.id] : [])];
}
