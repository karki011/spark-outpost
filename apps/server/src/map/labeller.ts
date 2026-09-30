import type { MapCategory, MapKind } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { callJev, type JevAccess, type JevCall } from '../orchestration/jev-calls.ts';
import { areaEvidence, type ReadContent } from './label-evidence.ts';
import {
  describeArea,
  labelQuestions,
  nameCandidates,
  parseLabel,
  type LabelChoice,
} from './label-questions.ts';
import { recordJevCall, saveLabel, storedLabels, type StoredLabel } from './model-store.ts';
import type { Gate } from './pace.ts';
import {
  LABEL_BASIS_FILES,
  LABEL_MAX_AREAS,
  MAP_LABEL_POLICY,
  RELABEL_BELOW_OVERLAP,
} from './policy.ts';

export interface LabelArea {
  id: string;
  root: string;
  source: string;
  package: string;
  reason: string;
  fileCount: number;
  lineCount: number;
  fanIn: number;
  fanOut: number;
  usedBy: string[];
  uses: string[];
  languages: string[];
  ranked: string[];
  ruleCategory: MapCategory;
  ruleKind: MapKind;
}

export interface LabelDeps {
  db: Queryable;
  repoId: string;
  repoName: string;
  jev: JevAccess | null;
  gate: Gate;
  signal: AbortSignal;
  read: ReadContent;
  ignore: readonly string[];
  progress: (done: number, total: number, jevAreas?: number) => Promise<void>;
}

export interface LabelTotals {
  asked: number;
  inputTokens: number;
  costUsd: number;
}

export async function labelAreasFromDb(db: Queryable, repoId: string): Promise<LabelArea[]> {
  const { rows } = await db.query<{
    id: string;
    root: string;
    source: string;
    package: string;
    reason: string;
    file_count: number;
    line_count: number;
    fan_in: number;
    fan_out: number;
    rule_category: MapCategory;
    rule_kind: MapKind;
    used_by: string[];
    uses: string[];
    languages: string[];
    ranked: string[];
  }>(
    `SELECT a.id, a.root, a.source, a.package, a.reason, a.file_count, a.line_count, a.fan_in,
       a.fan_out, a.rule_category, a.rule_kind,
       ARRAY(SELECT s.root FROM map_area_edges e JOIN map_areas s ON s.repo_id = e.repo_id
         AND s.id = e.from_area WHERE e.repo_id = a.repo_id AND e.to_area = a.id
         ORDER BY e.weight DESC, s.root LIMIT 8) AS used_by,
       ARRAY(SELECT t.root FROM map_area_edges e JOIN map_areas t ON t.repo_id = e.repo_id
         AND t.id = e.to_area WHERE e.repo_id = a.repo_id AND e.from_area = a.id
         ORDER BY e.weight DESC, t.root LIMIT 8) AS uses,
       ARRAY(SELECT f.language FROM map_files f WHERE f.repo_id = a.repo_id AND f.area_id = a.id
         GROUP BY f.language ORDER BY count(*) DESC, f.language LIMIT 5) AS languages,
       ARRAY(SELECT f.path FROM map_files f WHERE f.repo_id = a.repo_id AND f.area_id = a.id
         ORDER BY f.importance DESC, f.path) AS ranked
     FROM map_areas a WHERE a.repo_id = $1
     ORDER BY a.importance DESC, a.file_count DESC, a.root`,
    [repoId],
  );
  return rows.map((row) => ({
    id: row.id,
    root: row.root,
    source: row.source,
    package: row.package,
    reason: row.reason,
    fileCount: row.file_count,
    lineCount: row.line_count,
    fanIn: row.fan_in,
    fanOut: row.fan_out,
    usedBy: row.used_by,
    uses: row.uses,
    languages: row.languages,
    ranked: row.ranked,
    ruleCategory: row.rule_category,
    ruleKind: row.rule_kind,
  }));
}

function overlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((path) => right.has(path)).length / union.size;
}

export function needsLabel(
  stored: StoredLabel | undefined,
  basis: readonly string[],
  jevReady: boolean,
) {
  if (!stored || stored.policyVersion !== MAP_LABEL_POLICY) return true;
  if (jevReady && stored.source === 'rules' && stored.confidence === null) return true;
  return overlap(stored.basis, basis) < RELABEL_BELOW_OVERLAP;
}

function areaState(area: LabelArea, repoName: string): Record<string, unknown> {
  return {
    repository: repoName,
    root: area.root,
    package: area.package,
    grouped_because: area.reason,
    files: area.fileCount,
    lines: area.lineCount,
    languages: area.languages,
    used_by_areas: area.usedBy,
    uses_areas: area.uses,
  };
}

function areaFacts(area: LabelArea): string[] {
  return [
    `Area ${area.root} in package ${area.package}: ${area.fileCount} files, ${area.lineCount} lines.`,
    `Imports into this area from other areas: ${area.fanIn}. Imports out of it: ${area.fanOut}.`,
  ];
}

async function askJev(deps: LabelDeps, area: LabelArea, names: string[]) {
  const evidence = await areaEvidence({
    facts: areaFacts(area),
    rankedPaths: area.ranked,
    ignore: deps.ignore,
    read: deps.read,
  });
  const call = await callJev(
    deps.jev,
    () => labelQuestions(areaState(area, deps.repoName), evidence.text, names),
    deps.signal,
  );
  return { call, contents: evidence.contents };
}

async function labelOne(
  deps: LabelDeps,
  area: LabelArea,
  useJev: boolean,
): Promise<JevCall | null> {
  const names = nameCandidates(area.root, area.package, area.ranked.slice(0, 5));
  const rules = { category: area.ruleCategory, kind: area.ruleKind };
  let choice: LabelChoice = parseLabel(null, names, rules);
  let call: JevCall | null = null;
  if (useJev) {
    const asked = await askJev(deps, area, names);
    call = asked.call;
    choice = parseLabel(call.response, names, rules);
    await recordJevCall(deps.db, deps.repoId, {
      purpose: 'area_label',
      subject: area.id,
      policyVersion: MAP_LABEL_POLICY,
      call,
      answer: { ...choice, contents: asked.contents },
    });
  }
  await saveLabel(deps.db, deps.repoId, {
    areaId: area.id,
    source: choice.source,
    category: choice.category,
    kind: choice.kind,
    name: choice.name,
    description: describeArea(choice.kind, {
      root: area.root,
      fileCount: area.fileCount,
      lineCount: area.lineCount,
      languages: area.languages,
      topFiles: area.ranked,
      usedBy: area.usedBy.length,
      uses: area.uses.length,
    }),
    confidence: choice.confidence,
    basis: area.ranked.slice(0, LABEL_BASIS_FILES),
    policyVersion: MAP_LABEL_POLICY,
  });
  return call;
}

export async function labelAreas(deps: LabelDeps): Promise<LabelTotals> {
  const areas = await labelAreasFromDb(deps.db, deps.repoId);
  const stored = await storedLabels(deps.db, deps.repoId);
  const jevReady = deps.jev !== null;
  const todo = areas.filter((area) =>
    needsLabel(stored.get(area.id), area.ranked.slice(0, LABEL_BASIS_FILES), jevReady),
  );
  const totals: LabelTotals = { asked: 0, inputTokens: 0, costUsd: 0 };
  await deps.progress(0, todo.length, jevReady ? Math.min(todo.length, LABEL_MAX_AREAS) : 0);
  for (const [index, area] of todo.entries()) {
    const useJev = jevReady && index < LABEL_MAX_AREAS;
    if (useJev) await deps.gate.step();
    const call = await labelOne(deps, area, useJev);
    if (call?.status === 'answered') totals.asked += 1;
    totals.inputTokens += call?.usage?.inputTokens ?? 0;
    totals.costUsd += call?.usage?.costUsd ?? 0;
    await deps.progress(index + 1, todo.length);
  }
  return totals;
}
