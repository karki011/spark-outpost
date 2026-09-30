import { useLayoutEffect, useRef, useState } from 'react';
import { LINK_LABELS, type Bridge } from './bridges.ts';
import { baseName, folderOf } from './file-kind.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { JevLabel, KindTag } from './JevLabel.tsx';
import { fileFacts } from './map-model.ts';
import type { Scene } from './scene.ts';

export type TooltipTarget =
  | { type: 'file'; key: string; x: number; y: number }
  | { type: 'bridge'; bridge: Bridge; x: number; y: number };

interface MapTooltipProps {
  target: TooltipTarget | null;
  scene: Scene;
  changed: ReadonlySet<number>;
  bounds: { width: number; height: number };
}

const OFFSET = 16;

function FileTip({ scene, index, changed }: { scene: Scene; index: number; changed: boolean }) {
  const now = useMinuteClock();
  const file = scene.files[index]!;
  const area = scene.areas[file.areaIndex]!.area;
  return (
    <>
      <div className="map-tip-path">
        {folderOf(file.path)}
        <b>{baseName(file.path)}</b>
      </div>
      <div className="map-tip-big">
        <strong>{file.fanIn}</strong> {file.fanIn === 1 ? 'file depends' : 'files depend'} on this
      </div>
      <div className="map-tip-sub">{fileFacts(file, now)}</div>
      {changed && <div className="map-tip-sub map-warm">Changed in this chat</div>}
      <div className="map-tip-row">
        <KindTag kind={file.kind} />
        <span className="map-sp" />
        <JevLabel area={area} />
      </div>
    </>
  );
}

function BridgeTip({ scene, bridge }: { scene: Scene; bridge: Bridge }) {
  const first = bridge.links[0]!;
  const name = (projectId: string, path: string) => {
    const project = scene.projects.find((p) => p.projectId === projectId)?.name;
    return `${baseName(path)}${project ? ` in ${project}` : ''}`;
  };
  return (
    <>
      {bridge.links.slice(0, 4).map((link) => (
        <div key={`${link.label}:${link.fromLine}`} className="map-tip-ep map-mono">
          {link.label}
        </div>
      ))}
      {bridge.links.length > 4 && (
        <div className="map-tip-sub">+{bridge.links.length - 4} more endpoints</div>
      )}
      <div className="map-tip-row map-tip-col">
        <div className="map-tip-sub">
          Called from <span className="map-mono">{name(first.fromProjectId, first.fromPath)}</span>
        </div>
        <div className="map-tip-sub">
          Handled in <span className="map-mono">{name(first.toProjectId, first.toPath)}</span>
        </div>
      </div>
      <div className="map-tip-row">
        <span className="map-tip-sub">
          {LINK_LABELS[bridge.kind]} · match {bridge.confidence.toFixed(2)}
        </span>
        <span className="map-sp" />
        <span className="map-tip-sub">Click to trace the likely path</span>
      </div>
    </>
  );
}

export function MapTooltip({ target, scene, changed, bounds }: MapTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !target) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = target.x + OFFSET;
    let top = target.y + OFFSET;
    if (left + width > bounds.width - 10) left = target.x - width - OFFSET;
    if (top + height > bounds.height - 10) top = target.y - height - OFFSET;
    setPlace({
      left: Math.max(8, Math.min(left, bounds.width - width - 8)),
      top: Math.max(8, Math.min(top, bounds.height - height - 8)),
    });
  }, [target, bounds.width, bounds.height]);
  const file = target?.type === 'file' ? scene.fileByKey.get(target.key) : undefined;
  const valid = target && (target.type === 'bridge' || file !== undefined);
  return (
    <div
      ref={ref}
      className={valid ? 'map-tip map-glass show' : 'map-tip map-glass'}
      role={valid ? 'tooltip' : undefined}
      aria-hidden={!valid}
      style={place}
    >
      {valid && file !== undefined && (
        <FileTip scene={scene} index={file} changed={changed.has(file)} />
      )}
      {valid && target.type === 'bridge' && <BridgeTip scene={scene} bridge={target.bridge} />}
    </div>
  );
}
