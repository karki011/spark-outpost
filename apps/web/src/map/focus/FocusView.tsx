import './focus.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MapNeighbor } from '@spark-outpost/contracts';
import { Segmented } from '../../ui/Segmented.tsx';
import { baseName, FILE_KIND_LABELS, folderOf } from '../file-kind.ts';
import { KindDot } from '../JevLabel.tsx';
import { mapApi, mapKeys } from '../map-api.ts';
import { CATEGORY_LABELS } from '../map-model.ts';
import { areaKey, type Scene } from '../scene.ts';
import { byArea, impactSummary, type NeighborGroup } from './focus-model.ts';

export interface FocusTarget {
  projectId: string;
  path: string;
}

interface FocusViewProps {
  scene: Scene;
  target: FocusTarget | null;
  versions: ReadonlyMap<string, string>;
  onFocus: (target: FocusTarget) => void;
  onDetails: (target: FocusTarget) => void;
}

const HOPS = [
  { id: '1', label: '1 hop' },
  { id: '2', label: '2 hops' },
];
const SUGGESTED = 8;
const SKELETON = [72, 48, 64, 56, 80];

function Suggestions({ scene, onFocus }: Pick<FocusViewProps, 'scene' | 'onFocus'>) {
  const top = [...scene.areas]
    .sort((a, b) => b.area.importance - a.area.importance)
    .flatMap((entry) =>
      entry.area.topFiles
        .slice(0, 1)
        .map((path) => ({ projectId: entry.projectId, path, area: entry.area })),
    )
    .slice(0, SUGGESTED);
  return (
    <div className="map-focus-pick">
      <h2>Pick a file to focus on</h2>
      <p>
        Focus shows the files one file imports, the files that import it, and what could break if
        you change it. Press <kbd>/</kbd> to search, or start with one of the busiest files:
      </p>
      <ul aria-label="Suggested files">
        {top.map((file) => (
          <li key={`${file.projectId}:${file.path}`}>
            <button type="button" onClick={() => onFocus(file)}>
              <span className="map-mono">{baseName(file.path)}</span>
              <small>{file.area.name}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileRow({ file, onPick }: { file: MapNeighbor; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-label={`${file.path}${file.hop === 2 ? ', 2 hops away' : ''}. Focus on it.`}
      >
        <KindDot kind={file.kind} />
        <span className="map-focus-fname map-mono">{baseName(file.path)}</span>
        <small className="map-focus-dir">{folderOf(file.path)}</small>
        {file.hop === 2 && <span className="map-focus-hop">2 hops</span>}
      </button>
    </li>
  );
}

interface ColumnProps {
  id: string;
  title: string;
  empty: string;
  total: number;
  groups: NeighborGroup[];
  onPick: (path: string) => void;
}

function Column({ id, title, empty, total, groups, onPick }: ColumnProps) {
  const shown = groups.reduce((sum, group) => sum + group.files.length, 0);
  return (
    <section className="map-focus-col" aria-labelledby={id}>
      <h3 id={id}>
        {title} <span className="map-n">{total.toLocaleString('en-US')}</span>
      </h3>
      {groups.length === 0 && <p className="map-empty-note">{empty}</p>}
      {groups.map((group) => (
        <div key={group.key} className="map-focus-area">
          <h4>
            {group.area && <i className={`map-tier ${group.area.category}`} aria-hidden="true" />}
            <span>{group.area?.name ?? 'Other files'}</span>
            {group.area && (
              <span className="map-focus-cat">{CATEGORY_LABELS[group.area.category]}</span>
            )}
            <span className="map-n">{group.files.length}</span>
          </h4>
          <ul aria-label={`${title} in ${group.area?.name ?? 'other areas'}`}>
            {group.files.map((file) => (
              <FileRow key={file.path} file={file} onPick={() => onPick(file.path)} />
            ))}
          </ul>
        </div>
      ))}
      {total > shown && (
        <p className="map-empty-note">and {(total - shown).toLocaleString('en-US')} more</p>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="map-focus-cols" aria-busy="true" aria-label="Loading neighbours">
      {[0, 1, 2].map((column) => (
        <div key={column} className="map-focus-col">
          {SKELETON.map((width) => (
            <span
              key={width}
              className="map-sk"
              style={{ width: `${column === 1 ? 60 : width}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FocusView({ scene, target, versions, onFocus, onDetails }: FocusViewProps) {
  const [hops, setHops] = useState(1);
  const query = useQuery({
    queryKey: mapKeys.neighbors(
      target?.projectId ?? '',
      target?.path ?? '',
      hops,
      versions.get(target?.projectId ?? '') ?? '',
    ),
    queryFn: () => mapApi.neighbors(target!.projectId, target!.path, hops),
    enabled: target !== null,
    retry: false,
  });
  if (!target) {
    return (
      <div className="map-focus">
        <Suggestions scene={scene} onFocus={onFocus} />
      </div>
    );
  }
  const data = query.data;
  const area = data
    ? scene.areas[scene.areaByKey.get(areaKey(target.projectId, data.areaId)) ?? -1]?.area
    : undefined;
  const summary = data ? impactSummary(data) : null;
  const pick = (path: string) => onFocus({ projectId: target.projectId, path });
  const kind = scene.files[scene.fileByKey.get(`${target.projectId}:${target.path}`) ?? -1]?.kind;
  return (
    <div className="map-focus">
      <header className="map-focus-head">
        <div className="map-focus-title">
          <h2>{baseName(target.path)}</h2>
          <p className="map-mono">{folderOf(target.path)}</p>
        </div>
        {area && (
          <span className="map-focus-badge">
            <i className={`map-tier ${area.category}`} aria-hidden="true" />
            {CATEGORY_LABELS[area.category]} · {area.name}
          </span>
        )}
        {kind && (
          <span className="map-focus-badge">
            <KindDot kind={kind} />
            {FILE_KIND_LABELS[kind]}
          </span>
        )}
        <span className="map-sp" />
        <Segmented
          ariaLabel="How far to look"
          options={HOPS}
          value={String(hops)}
          onChange={(id) => setHops(Number(id))}
        />
        <button type="button" className="map-btn" onClick={() => onDetails(target)}>
          Details
        </button>
      </header>
      {query.isError && (
        <p className="map-focus-missing" role="status">
          {baseName(target.path)} is not on the map yet. Pick another file or wait for the map to
          update.
        </p>
      )}
      {query.isPending && <Skeleton />}
      {data && summary && (
        <>
          <section className="map-focus-impact" aria-labelledby="map-focus-impact">
            <h3 id="map-focus-impact">What breaks if I change this?</h3>
            <p className="map-focus-headline">{summary.headline}</p>
            {summary.detail && <p>{summary.detail}</p>}
            {summary.core && <p className="map-focus-core">{summary.core}</p>}
          </section>
          <div className="map-focus-cols">
            <Column
              id="map-focus-imports"
              title="Imports"
              empty="This file imports nothing on the map."
              total={data.importsTotal}
              groups={byArea(scene, target.projectId, data.imports)}
              onPick={pick}
            />
            <div className="map-focus-centre" aria-hidden="true">
              <span className="map-focus-arrow">←</span>
              <b className="map-mono">{baseName(target.path)}</b>
              <span className="map-focus-arrow">←</span>
            </div>
            <Column
              id="map-focus-importers"
              title="Imported by"
              empty="Nothing on the map imports this file."
              total={data.importedByTotal}
              groups={byArea(scene, target.projectId, data.importedBy)}
              onPick={pick}
            />
          </div>
        </>
      )}
    </div>
  );
}
