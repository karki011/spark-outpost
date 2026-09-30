import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bridge } from './bridges.ts';
import { likelyPath } from './bridges.ts';
import { BridgeList, PathCard } from './CombinedPanels.tsx';
import type { MapFilters, MapView } from './frame.ts';
import type { Highlights } from './map-model.ts';
import { AreaCrumb, MapLegend } from './MapOverlays.tsx';
import { MapTooltip, type TooltipTarget } from './MapTooltip.tsx';
import type { LoadCandidate } from './lod.ts';
import type { Scene } from './scene.ts';
import { SkyCanvas, type SkyHandle } from './SkyCanvas.tsx';

export interface SkyTargets {
  fly: { file: number; nonce: number } | null;
  area: { key: string; nonce: number } | null;
}

interface SkyViewProps {
  scene: Scene;
  bridges: readonly Bridge[];
  combined: boolean;
  filters: MapFilters;
  lit: Highlights;
  sheetIndex: number | null;
  flagged: ReadonlySet<number>;
  flagHover: string | null;
  inset: number;
  building: { done: number; total: number } | null;
  label: string;
  legend: boolean;
  bounds: { width: number; height: number };
  revealNonce: number;
  targets: SkyTargets;
  require: (keys: readonly string[]) => void;
  want: (candidates: readonly LoadCandidate[]) => void;
  onFile: (file: number) => void;
  onCloseSheet: () => void;
  onPath: (open: boolean) => void;
  onLegendHide: () => void;
  onRevealed: (shown: number, total: number, last: string | null) => void;
  announce: (text: string) => void;
}

export function SkyView(props: SkyViewProps) {
  const { scene, bridges, require, announce, onPath } = props;
  const skyRef = useRef<SkyHandle>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pathKey, setPathKey] = useState<string | null>(null);
  const [hover, setHover] = useState<TooltipTarget | null>(null);

  const openIndex = openKey ? (scene.areaByKey.get(openKey) ?? null) : null;
  const openReady = openIndex !== null && scene.areas[openIndex]!.complete ? openIndex : null;
  const pathBridge = bridges.find((bridge) => bridge.key === pathKey) ?? null;
  const path = useMemo(
    () => (pathBridge ? likelyPath(scene, pathBridge) : []),
    [scene, pathBridge],
  );
  useEffect(() => onPath(pathBridge !== null), [pathBridge, onPath]);

  const view = useMemo<MapView>(
    () => ({
      scene,
      filters: props.filters,
      changed: props.lit.changed,
      dependents: props.lit.dependents,
      bridges: props.combined ? bridges : [],
      path,
      pathBridge: pathKey,
      selected: props.sheetIndex,
      flagged: props.flagged,
      flaggedHover: props.flagHover ? (scene.fileByKey.get(props.flagHover) ?? null) : null,
      inset: props.inset,
      building: props.building,
    }),
    [
      scene,
      props.filters,
      props.lit,
      props.combined,
      bridges,
      path,
      pathKey,
      props.sheetIndex,
      props.flagged,
      props.flagHover,
      props.inset,
      props.building,
    ],
  );

  const openArea = useCallback(
    (key: string) => {
      require([key]);
      setOpenKey(key);
      setPathKey(null);
      setHover(null);
      const area = scene.areas[scene.areaByKey.get(key)!]!.area;
      announce(`${area.name}. ${area.fileCount} files. Press Escape to go back to the sky.`);
    },
    [require, scene, announce],
  );
  const closeArea = () => {
    setOpenKey(null);
    setHover(null);
  };

  const { fly, area: areaTarget } = props.targets;
  const flown = useRef(0);
  useEffect(() => {
    if (!fly || fly.nonce === flown.current) return;
    flown.current = fly.nonce;
    const target = scene.areas[scene.files[fly.file]!.areaIndex]!.key;
    setOpenKey((open) => (open && open !== target ? null : open));
  }, [fly, scene]);
  const shown = useRef(0);
  useEffect(() => {
    if (!areaTarget || areaTarget.nonce === shown.current) return;
    shown.current = areaTarget.nonce;
    openArea(areaTarget.key);
  }, [areaTarget, openArea]);

  const tracePath = (key: string) => {
    const bridge = bridges.find((b) => b.key === key);
    if (!bridge) return;
    require([bridge.fromArea, bridge.toArea]);
    setPathKey(key);
    setHover(null);
    announce(`Likely path for ${bridge.links[0]!.label}.`);
  };

  const back = () => {
    if (props.sheetIndex !== null) props.onCloseSheet();
    else if (pathKey) setPathKey(null);
    else if (openKey) closeArea();
  };

  const openFile = (index: number) => {
    setHover(null);
    props.onFile(index);
  };

  return (
    <>
      <SkyCanvas
        handle={skyRef}
        view={view}
        openArea={openReady}
        label={props.label}
        revealNonce={props.revealNonce}
        flyTarget={fly}
        callbacks={{
          hover: (target, x, y) => {
            if (!target || target.type === 'area') setHover(null);
            else if (target.type === 'file')
              setHover({ type: 'file', key: scene.files[target.index]!.key, x, y });
            else {
              const bridge = bridges.find((b) => b.key === target.key);
              setHover(bridge ? { type: 'bridge', bridge, x, y } : null);
            }
          },
          openFile,
          openArea: (area) => openArea(scene.areas[area]!.key),
          pickBridge: tracePath,
          clickSky: () => {
            if (pathKey) setPathKey(null);
            else if (props.sheetIndex !== null) props.onCloseSheet();
          },
          back,
          announce,
          revealed: (count, total, last) =>
            props.onRevealed(count, total, scene.areas[last]?.area.name ?? null),
          wantFiles: props.want,
        }}
      />
      <MapTooltip target={hover} scene={scene} changed={props.lit.changed} bounds={props.bounds} />
      {openIndex !== null && <AreaCrumb scene={scene} area={openIndex} onBack={closeArea} />}
      {props.legend && (
        <MapLegend
          area={openIndex !== null}
          combined={props.combined}
          onHide={props.onLegendHide}
        />
      )}
      {props.combined && (
        <BridgeList
          bridges={bridges.filter((bridge) => props.filters.links.has(bridge.kind))}
          onFocus={(key) => skyRef.current?.showBridge(key)}
          onPick={tracePath}
        />
      )}
      {pathBridge && (
        <PathCard
          scene={scene}
          bridge={pathBridge}
          path={path}
          onStep={openFile}
          onClose={() => setPathKey(null)}
        />
      )}
    </>
  );
}
