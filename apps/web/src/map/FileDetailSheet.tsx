import { useEffect, useRef, useState } from 'react';
import { FileBody } from '../chat/project/file-sheet/FileSheet.tsx';
import { isMarkdown } from '../chat/project/file-sheet/front-matter.ts';
import { XIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { baseName, folderOf } from './file-kind.ts';
import { JevLabel, KindDot, KindTag } from './JevLabel.tsx';
import { CATEGORY_LABELS } from './map-model.ts';
import { fileFacts } from './MapTooltip.tsx';
import type { Scene } from './scene.ts';

interface FileDetailSheetProps {
  scene: Scene;
  file: number;
  changed: boolean;
  onClose: () => void;
  onGo: (file: number) => void;
  onOpenInChat: (projectId: string, path: string) => void;
  onCopied: () => void;
}

const LISTED = 5;
const SKELETON = [62, 88, 40, 0, 74, 92, 55, 81, 36, 0, 68, 47];
const INDENT = [0, 0, 4, 0, 0, 4, 8, 8, 4, 0, 0, 4];
const VIEWS = [
  { id: 'preview', label: 'Preview' },
  { id: 'source', label: 'Source' },
];

function PreviewSkeleton() {
  return (
    <div className="map-preview-skel" role="img" aria-label="File preview is loading">
      {SKELETON.map((width, row) => (
        <div key={row} className="map-ln">
          <em>{row + 1}</em>
          {width > 0 && (
            <span className="map-sk" style={{ width: `${width}%`, marginLeft: INDENT[row]! * 6 }} />
          )}
        </div>
      ))}
    </div>
  );
}

function FileList({
  scene,
  files,
  empty,
  onGo,
}: {
  scene: Scene;
  files: number[];
  empty: string;
  onGo: (file: number) => void;
}) {
  if (files.length === 0) return <p className="map-empty-note">{empty}</p>;
  const sorted = [...files].sort((a, b) => scene.files[b]!.importance - scene.files[a]!.importance);
  return (
    <>
      <ul className="map-flist">
        {sorted.slice(0, LISTED).map((index) => {
          const file = scene.files[index]!;
          return (
            <li key={file.key}>
              <button type="button" onClick={() => onGo(index)}>
                <KindDot kind={file.kind} />
                <span className="map-nm">{file.name}</span>
                <span className="map-n">{scene.areas[file.areaIndex]!.area.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length > LISTED && (
        <p className="map-empty-note">and {sorted.length - LISTED} more</p>
      )}
    </>
  );
}

export function FileDetailSheet({
  scene,
  file,
  changed,
  onClose,
  onGo,
  onOpenInChat,
  onCopied,
}: FileDetailSheetProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState('preview');
  const f = scene.files[file]!;
  const area = scene.areas[f.areaIndex]!.area;
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [file]);
  const copy = () => {
    void navigator.clipboard?.writeText(f.path).then(onCopied, onCopied);
  };
  return (
    <aside
      className="map-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-sheet-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="map-sh-head">
        <div>
          <h2 id="map-sheet-title" ref={titleRef} tabIndex={-1}>
            {baseName(f.path)}
          </h2>
          <p>{folderOf(f.path)}</p>
        </div>
        <button
          type="button"
          className="map-icon-btn"
          aria-label="Close file details"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </header>
      <div className="map-sh-body">
        <div className="map-badges">
          <span className="map-badge">
            <KindTag kind={f.kind} />
          </span>
          <span className="map-badge">{area.name}</span>
          <span className="map-badge">{CATEGORY_LABELS[area.category]}</span>
          {changed && <span className="map-badge warm">Changed in this chat</span>}
        </div>
        <div className="map-stats">
          <div>
            <b>{f.fanIn}</b>
            <span>files depend on this</span>
          </div>
          <div>
            <b>{f.fanOut}</b>
            <span>files it imports</span>
          </div>
          <div>
            <b>{f.lines.toLocaleString('en-US')}</b>
            <span>lines</span>
          </div>
        </div>
        <section className="map-sh-sec" aria-labelledby="map-sheet-label">
          <h3 id="map-sheet-label">Jev’s label</h3>
          <div className="map-jevcard">
            <JevLabel area={area} size={24} />
            <small>{fileFacts(f.reasons, f.lines)}</small>
          </div>
        </section>
        <section className="map-sh-sec" aria-labelledby="map-sheet-preview">
          <div className="map-sh-row">
            <h3 id="map-sheet-preview">Preview</h3>
            {isMarkdown(f.path) && (
              <Segmented
                ariaLabel="Show as"
                options={VIEWS}
                value={view}
                onChange={(id) => setView(id)}
              />
            )}
          </div>
          <div className="map-preview">
            <FileBody
              file={{ projectId: f.projectId, path: f.path }}
              view={view}
              loading={<PreviewSkeleton />}
            />
          </div>
        </section>
        <section className="map-sh-sec" aria-labelledby="map-sheet-in">
          <h3 id="map-sheet-in">Depended on by</h3>
          <FileList
            scene={scene}
            files={scene.ins[file]!}
            empty="Nothing on the map imports this file."
            onGo={onGo}
          />
        </section>
        <section className="map-sh-sec" aria-labelledby="map-sheet-out">
          <h3 id="map-sheet-out">Imports</h3>
          <FileList
            scene={scene}
            files={scene.outs[file]!}
            empty="This file imports nothing on the map."
            onGo={onGo}
          />
        </section>
      </div>
      <footer className="map-sh-foot">
        <button
          type="button"
          className="map-btn primary"
          onClick={() => onOpenInChat(f.projectId, f.path)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          Open in chat
        </button>
        <button type="button" className="map-btn" onClick={copy}>
          Copy path
        </button>
      </footer>
    </aside>
  );
}
