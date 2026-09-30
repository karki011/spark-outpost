import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAP_CATEGORIES } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import type { RepoFile } from '../chat/project/use-file-search.ts';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { AreaList } from './AreaList.tsx';
import { bridgeAreaKeys, LINK_KINDS, likelyPath } from './bridges.ts';
import { buildPhase, buildProgress, SparkSay } from './BuildStatus.tsx';
import { BridgeList, PathCard, UnmatchedPanel } from './CombinedPanels.tsx';
import { FileDetailSheet } from './FileDetailSheet.tsx';
import { FILE_KINDS } from './file-kind.ts';
import type { MapFilters as Filters, MapView } from './frame.ts';
import type { UnmatchedEndpoint } from './map-api.ts';
import { categoryCounts, highlights, kindCounts } from './map-model.ts';
import { MapFilters } from './MapFilters.tsx';
import { MapHeader } from './MapHeader.tsx';
import { AreaCrumb, MapLegend } from './MapOverlays.tsx';
import { MapTooltip, type TooltipTarget } from './MapTooltip.tsx';
import { ReviewAreas } from './ReviewAreas.tsx';
import { fileKey } from './scene.ts';
import { SkyCanvas, type SkyHandle } from './SkyCanvas.tsx';
import { useAreaReview } from './use-area-review.ts';
import { useChatChanges } from './use-chat-changes.ts';
import { useLocate, type Wanted } from './use-locate.ts';
import { useMapData } from './use-map-data.ts';
import { useMapSelection, usePhone } from './use-map-selection.ts';
import './map.css';
import './map-stage.css';
import './map-popovers.css';
import './map-sheet.css';
import './map-combined.css';
import './map-phone.css';

interface MapPageProps {
  onOpenInChat: (projectId: string, path: string) => void;
}

const ALL_FILTERS: Filters = {
  categories: new Set(MAP_CATEGORIES),
  kinds: new Set(FILE_KINDS),
  links: new Set(LINK_KINDS),
};
const SHEET_W = 400;
const REVIEW_W = 420;
const UNMATCHED_W = 344;
const WIDE = 900;

export function MapPage({ onOpenInChat }: MapPageProps) {
  const projectList = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const projects = projectList.data ?? [];
  const { selected, choose } = useMapSelection(projects);
  const data = useMapData(projects, selected);
  const { scene } = data;
  const phone = usePhone();
  const toaster = useToast();
  const review = useAreaReview(toaster.show);
  const searchRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<SkyHandle>(null);
  const combined = data.projects.length > 1;

  const [filters, setFilters] = useState(ALL_FILTERS);
  const [changesOn, setChangesOn] = useState(false);
  const [dependentsOn, setDependentsOn] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [legend, setLegend] = useState<boolean | null>(null);
  const [pathKey, setPathKey] = useState<string | null>(null);
  const [unmatchedOpen, setUnmatchedOpen] = useState(true);
  const [flagHover, setFlagHover] = useState<string | null>(null);
  const [hover, setHover] = useState<TooltipTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [skyOnPhone, setSkyOnPhone] = useState(false);
  const [revealNonce, setRevealNonce] = useState(0);
  const [revealed, setRevealed] = useState<{
    shown: number;
    total: number;
    last: string | null;
  } | null>(null);
  useEffect(() => {
    if (!revealed || revealed.shown < revealed.total) return;
    const timer = setTimeout(() => setRevealed(null), 3200);
    return () => clearTimeout(timer);
  }, [revealed]);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  const chatChanges = useChatChanges(selected, changesOn);
  const lit = useMemo(
    () =>
      highlights(scene, chatChanges.projectId, changesOn ? chatChanges.paths : [], dependentsOn),
    [scene, chatChanges.projectId, chatChanges.paths, changesOn, dependentsOn],
  );
  const { require } = data;
  const changedWanted = useMemo(
    () =>
      changesOn && chatChanges.projectId
        ? { projectId: chatChanges.projectId, paths: chatChanges.paths }
        : null,
    [changesOn, chatChanges.projectId, chatChanges.paths],
  );
  useLocate(scene, changedWanted, require);
  const [find, setFind] = useState<{ wanted: Wanted; nonce: number } | null>(null);
  const findState = useLocate(scene, find?.wanted ?? null, require);
  useEffect(() => {
    if (combined && data.bridges.length > 0) require(bridgeAreaKeys(data.bridges));
  }, [combined, data.bridges, require]);

  const phase = buildPhase(data.maps);
  const building = useRef(false);
  useEffect(() => {
    if (phase === 'first' || phase === 'waiting') building.current = true;
    else if (building.current && scene.areas.length > 0) {
      building.current = false;
      setRevealNonce((n) => n + 1);
    }
  }, [phase, scene.areas.length]);

  const openIndex = openKey ? (scene.areaByKey.get(openKey) ?? null) : null;
  const openReady = openIndex !== null && scene.areas[openIndex]!.complete ? openIndex : null;
  const sheetIndex = sheetKey ? (scene.fileByKey.get(sheetKey) ?? null) : null;
  const pathBridge = data.bridges.find((bridge) => bridge.key === pathKey) ?? null;
  const path = useMemo(
    () => (pathBridge ? likelyPath(scene, pathBridge) : []),
    [scene, pathBridge],
  );
  const flagged = useMemo(() => {
    const files = new Set<number>();
    if (!data.unmatched || !unmatchedOpen) return files;
    for (const route of data.unmatched.routes) {
      const index = scene.fileByKey.get(fileKey(route.projectId, route.file));
      if (index !== undefined) files.add(index);
    }
    return files;
  }, [data.unmatched, unmatchedOpen, scene]);
  const showUnmatched = combined && data.unmatched !== null && unmatchedOpen && !pathBridge;
  const wide = bounds.width >= WIDE;
  const inset = !wide
    ? 0
    : reviewOpen
      ? REVIEW_W
      : sheetIndex !== null
        ? SHEET_W
        : showUnmatched
          ? UNMATCHED_W
          : 0;
  const skeleton = data.pending || (scene.areas.length === 0 && phase !== 'failed');

  const view = useMemo<MapView>(
    () => ({
      scene,
      filters,
      changed: lit.changed,
      dependents: lit.dependents,
      bridges: combined ? data.bridges : [],
      path,
      pathBridge: pathKey,
      selected: sheetIndex,
      flagged,
      flaggedHover: flagHover ? (scene.fileByKey.get(flagHover) ?? null) : null,
      inset,
      building: skeleton ? buildProgress(data.maps) : null,
    }),
    [
      scene,
      filters,
      lit,
      combined,
      data.bridges,
      path,
      pathKey,
      sheetIndex,
      flagged,
      flagHover,
      inset,
      skeleton,
      data.maps,
    ],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() =>
      setBounds({ width: stage.clientWidth, height: stage.clientHeight }),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openArea = useCallback(
    (key: string) => {
      require([key]);
      setOpenKey(key);
      setPathKey(null);
      setHover(null);
      const area = scene.areas[scene.areaByKey.get(key)!]!.area;
      setAnnouncement(`${area.name}. ${area.fileCount} files. Press Escape to go back to the sky.`);
    },
    [require, scene],
  );
  const closeArea = () => {
    setOpenKey(null);
    setHover(null);
  };

  const goToFile = (projectId: string, path: string) => {
    const index = scene.fileByKey.get(fileKey(projectId, path));
    const area = index === undefined ? null : scene.areas[scene.files[index]!.areaIndex]!.key;
    if (openKey && area !== openKey) setOpenKey(null);
    if (phone) setSkyOnPhone(true);
    setFind({ wanted: { projectId, paths: [path] }, nonce: Date.now() });
  };
  const reported = useRef(0);
  useEffect(() => {
    if (!find || findState !== 'missing' || reported.current === find.nonce) return;
    reported.current = find.nonce;
    toaster.show({ text: `${find.wanted.paths[0]} is not on the map.` });
  }, [find, findState, toaster]);
  const flyIndex =
    find && findState === 'found'
      ? scene.fileByKey.get(fileKey(find.wanted.projectId, find.wanted.paths[0]!))
      : undefined;
  const flyTarget = useMemo(
    () => (flyIndex !== undefined && find ? { file: flyIndex, nonce: find.nonce } : null),
    [flyIndex, find],
  );

  const back = () => {
    if (sheetKey) setSheetKey(null);
    else if (pathKey) setPathKey(null);
    else if (openKey) closeArea();
  };

  const tracePath = (key: string) => {
    const bridge = data.bridges.find((b) => b.key === key);
    if (!bridge) return;
    require([bridge.fromArea, bridge.toArea]);
    setPathKey(key);
    setHover(null);
    setAnnouncement(`Likely path for ${bridge.links[0]!.label}.`);
  };

  const openFile = (index: number) => {
    setSheetKey(scene.files[index]!.key);
    setReviewOpen(false);
    setHover(null);
  };

  const pickUnmatched = (endpoint: UnmatchedEndpoint) =>
    goToFile(endpoint.projectId, endpoint.file);
  const legendShown = (legend ?? (!combined && !phone)) && !pathBridge && !skeleton;
  const fileCount = data.maps.reduce((sum, map) => sum + (map.status?.fileCount ?? 0), 0);
  const reviewItems = scene.areas.map((entry) => ({
    key: entry.key,
    area: entry.area,
    projectName: combined
      ? (data.projects.find((p) => p.id === entry.projectId)?.name ?? null)
      : null,
  }));
  const label = combined
    ? `Combined map of ${data.projects.map((p) => p.name).join(' and ')}: ${scene.areas.length} areas, ${data.bridges.length} links.`
    : `Project map of ${data.projects[0]?.name ?? 'your project'}: ${scene.areas.length} areas as constellations.`;
  const listMode = phone && !skyOnPhone;

  if (projectList.data && projects.length === 0) {
    return (
      <main className="page map" aria-label="Project map">
        <div className="map-empty-page">
          <BlobScout size={48} mood="sleep" />
          <p>Add a project to a chat and Spark will draw its map here.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page map" aria-label="Project map">
      <MapHeader
        projects={projects}
        selected={selected}
        chosen={data.projects}
        maps={data.maps}
        searchRef={searchRef}
        changes={{
          on: changesOn,
          count: changesOn ? lit.changed.size : null,
          chat: chatChanges.chat?.title ?? null,
        }}
        dependents={dependentsOn}
        reviewOpen={reviewOpen}
        onProjects={(ids) => {
          choose(ids);
          setOpenKey(null);
          setSheetKey(null);
          setPathKey(null);
        }}
        onPick={(file: RepoFile) => goToFile(file.projectId, file.path)}
        onChanges={(on) => {
          setChangesOn(on);
          if (!on) setDependentsOn(false);
          else setAnnouncement('Files changed in this chat are lit up.');
        }}
        onDependents={setDependentsOn}
        onReview={() => {
          setReviewOpen((open) => !open);
          setSheetKey(null);
        }}
      />
      <MapFilters
        filters={filters}
        categoryCounts={categoryCounts(scene)}
        kindCounts={kindCounts(scene)}
        bridges={combined ? data.bridges : null}
        unmatched={
          data.unmatched ? data.unmatched.routes.length + data.unmatched.calls.length : null
        }
        unmatchedOpen={unmatchedOpen}
        legend={legendShown}
        onFilters={setFilters}
        onUnmatched={() => setUnmatchedOpen((open) => !open)}
        onLegend={() => setLegend(!legendShown)}
      />
      <div className="map-stage" ref={stageRef}>
        {phone && (
          <div className="map-mode">
            <Segmented
              ariaLabel="Show the map as"
              options={[
                { id: 'list', label: 'List' },
                { id: 'sky', label: 'Sky' },
              ]}
              value={listMode ? 'list' : 'sky'}
              onChange={(id) => setSkyOnPhone(id === 'sky')}
            />
          </div>
        )}
        {listMode ? (
          <AreaList
            scene={scene}
            area={openIndex}
            changed={lit.changed}
            onArea={(area) => (area === null ? closeArea() : openArea(scene.areas[area]!.key))}
            onFile={openFile}
          />
        ) : (
          <SkyCanvas
            handle={skyRef}
            view={view}
            openArea={openReady}
            label={label}
            revealNonce={revealNonce}
            flyTarget={flyTarget}
            callbacks={{
              hover: (target, x, y) => {
                if (!target || target.type === 'area') setHover(null);
                else if (target.type === 'file')
                  setHover({ type: 'file', key: scene.files[target.index]!.key, x, y });
                else {
                  const bridge = data.bridges.find((b) => b.key === target.key);
                  setHover(bridge ? { type: 'bridge', bridge, x, y } : null);
                }
              },
              openFile,
              openArea: (area) => openArea(scene.areas[area]!.key),
              pickBridge: tracePath,
              clickSky: () => {
                if (pathKey) setPathKey(null);
                else if (sheetKey) setSheetKey(null);
              },
              back,
              announce: setAnnouncement,
              revealed: (shown, total, last) =>
                setRevealed({ shown, total, last: scene.areas[last]?.area.name ?? null }),
              wantFiles: data.want,
            }}
          />
        )}
        <div className="sr-only" aria-live="polite">
          {announcement}
        </div>
        {!listMode && (
          <MapTooltip target={hover} scene={scene} changed={lit.changed} bounds={bounds} />
        )}
        {!listMode && openIndex !== null && (
          <AreaCrumb scene={scene} area={openIndex} onBack={closeArea} />
        )}
        {!listMode && legendShown && (
          <MapLegend
            area={openIndex !== null}
            combined={combined}
            onHide={() => setLegend(false)}
          />
        )}
        {!listMode && (
          <SparkSay
            maps={data.maps}
            phase={phase}
            progress={buildProgress(data.maps)}
            revealed={revealed}
          />
        )}
        {!listMode && showUnmatched && data.unmatched && (
          <UnmatchedPanel
            unmatched={data.unmatched}
            projectNames={new Map(data.projects.map((p) => [p.id, p.name]))}
            onPick={pickUnmatched}
            onHover={(endpoint) =>
              setFlagHover(endpoint ? fileKey(endpoint.projectId, endpoint.file) : null)
            }
            onClose={() => setUnmatchedOpen(false)}
          />
        )}
        {!listMode && combined && (
          <BridgeList
            bridges={data.bridges.filter((bridge) => filters.links.has(bridge.kind))}
            onFocus={(key) => skyRef.current?.showBridge(key)}
            onPick={tracePath}
          />
        )}
        {!listMode && pathBridge && (
          <PathCard
            scene={scene}
            bridge={pathBridge}
            path={path}
            onStep={openFile}
            onClose={() => setPathKey(null)}
          />
        )}
        {sheetIndex !== null && (
          <FileDetailSheet
            scene={scene}
            file={sheetIndex}
            changed={lit.changed.has(sheetIndex)}
            onClose={() => setSheetKey(null)}
            onGo={(index) => {
              openFile(index);
              const file = scene.files[index]!;
              goToFile(file.projectId, file.path);
            }}
            onOpenInChat={onOpenInChat}
            onCopied={() => toaster.show({ text: 'Path copied' })}
          />
        )}
        {reviewOpen && (
          <ReviewAreas
            items={reviewItems}
            fileCount={fileCount}
            onClose={() => setReviewOpen(false)}
            onShow={(key) => {
              if (phone) setReviewOpen(false);
              openArea(key);
            }}
            onCategory={(key, category) => {
              const entry = scene.areas[scene.areaByKey.get(key)!]!;
              void review(entry.projectId, entry.area, category);
            }}
          />
        )}
        <div className="map-toasts">
          <ToastHost toaster={toaster} />
        </div>
      </div>
    </main>
  );
}
