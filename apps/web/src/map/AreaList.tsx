import { BackIcon, ChevronIcon } from '../ui/icons.tsx';
import { JevLabel, KindDot } from './JevLabel.tsx';
import type { Scene } from './scene.ts';

const RANK = { core: 0, shared: 1, feature: 2 } as const;

interface AreaListProps {
  scene: Scene;
  area: number | null;
  changed: ReadonlySet<number>;
  onArea: (area: number | null) => void;
  onFile: (file: number) => void;
}

function Areas({ scene, onArea }: Pick<AreaListProps, 'scene' | 'onArea'>) {
  const sorted = [...scene.areas].sort(
    (a, b) =>
      RANK[a.area.category] - RANK[b.area.category] || b.area.importance - a.area.importance,
  );
  return (
    <ul className="map-list" aria-label="Areas">
      {sorted.map((entry) => (
        <li key={entry.key}>
          <button type="button" onClick={() => onArea(entry.index)}>
            <span className="map-list-main">
              <b>{entry.area.name}</b>
              <JevLabel area={entry.area} size={14} />
            </span>
            <span className="map-n">{entry.area.fileCount}</span>
            <ChevronIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Files({ scene, area, changed, onArea, onFile }: AreaListProps & { area: number }) {
  const entry = scene.areas[area]!;
  const files = [...entry.files].sort(
    (a, b) => scene.files[b]!.importance - scene.files[a]!.importance,
  );
  return (
    <>
      <div className="map-list-head">
        <button
          type="button"
          className="map-back"
          aria-label="Back to all areas"
          onClick={() => onArea(null)}
        >
          <BackIcon />
        </button>
        <h2>{entry.area.name}</h2>
        <span className="map-n">{entry.area.fileCount} files</span>
      </div>
      {files.length === 0 ? (
        <ul className="map-list" aria-label={`Files in ${entry.area.name}`} aria-busy="true">
          {[70, 52, 84, 60, 44].map((width) => (
            <li key={width} className="map-list-skel">
              <span className="map-sk" style={{ width: `${width}%` }} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="map-list" aria-label={`Files in ${entry.area.name}`}>
          {files.map((index) => {
            const file = scene.files[index]!;
            return (
              <li key={file.key}>
                <button type="button" onClick={() => onFile(index)}>
                  <KindDot kind={file.kind} />
                  <span className="map-list-main">
                    <b className="map-mono">{file.name}</b>
                    <small>
                      {file.fanIn} {file.fanIn === 1 ? 'file depends' : 'files depend'} on this
                      {changed.has(index) && (
                        <span className="map-warm"> · changed in this chat</span>
                      )}
                    </small>
                  </span>
                  <ChevronIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function AreaList(props: AreaListProps) {
  return (
    <div className="map-phone">
      {props.area === null ? (
        <Areas scene={props.scene} onArea={props.onArea} />
      ) : (
        <Files {...props} area={props.area} />
      )}
    </div>
  );
}
