import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAP_CATEGORIES, type MapUnmatchedEndpoint } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import type { RepoFile } from '../chat/project/use-file-search.ts';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { bridgeAreaKeys, LINK_KINDS } from './bridges.ts';
import { buildStages } from './build-stages.ts';
import { buildPhase, buildProgress, SparkSay } from './BuildStatus.tsx';
import { UnmatchedPanel } from './CombinedPanels.tsx';
import { FileDetailSheet } from './FileDetailSheet.tsx';
import { FILE_KINDS } from './file-kind.ts';
import { FocusView, type FocusTarget } from './focus/FocusView.tsx';
import type { MapFilters as Filters } from './frame.ts';
import { categoryCounts, highlights, kindCounts, needsCheck } from './map-model.ts';
import { useMapView, useViewTips, type MapViewId } from './map-views.ts';
import { MapEmpty, MapUnreachable, projectListView } from './MapEmpty.tsx';
import { MapFilters } from './MapFilters.tsx';
import { MapHeader } from './MapHeader.tsx';
import { OutlineView, type OutlineReveal } from './outline/OutlineView.tsx';
import { ReviewAreas } from './ReviewAreas.tsx';
import { fileKey } from './scene.ts';
import { SkyView, type SkyTargets } from './SkyView.tsx';
import type { TreeReveal } from './tree/TreeView.tsx';
import { useAreaReview } from './use-area-review.ts';
import { useChatChanges } from './use-chat-changes.ts';
import { useLocate, type Wanted } from './use-locate.ts';
import { useMapData } from './use-map-data.ts';
import { usePhone } from '../ui/breakpoints.ts';
import { useMapSelection } from './use-map-selection.ts';
import { useGroups, useViewSource } from './use-view-source.ts';
import { ViewSkeleton } from './ViewSkeleton.tsx';
import { ViewTip } from './ViewTip.tsx';
import './map.css';
import './map-stage.css';
import './map-popovers.css';
import './map-sheet.css';
import './map-combined.css';
import './map-phone.css';

const TreeView = lazy(() => import('./tree/TreeView.tsx'));

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
const RETRY_MS = 5_000;

export function MapPage({ onOpenInChat }: MapPageProps) {
  const projectList = useQuery({
    queryKey: projectKeys.all,
    queryFn: projectsApi.list,
    refetchInterval: (query) => (query.state.status === 'error' ? RETRY_MS : false),
  });
  const projects = projectList.data ?? [];
  const { selected, choose } = useMapSelection(projects);
  const data = useMapData(projects, selected);
  const { scene, require } = data;
  const phone = usePhone();
  const [view, setView] = useMapView(phone);
  const tips = useViewTips();
  const toaster = useToast();
  const review = useAreaReview(toaster.show);
  const searchRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const combined = data.projects.length > 1;

  const [filters, setFilters] = useState(ALL_FILTERS);
  const [changesOn, setChangesOn] = useState(false);
  const [dependentsOn, setDependentsOn] = useState(false);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [legend, setLegend] = useState<boolean | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [flagHover, setFlagHover] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [areaTarget, setAreaTarget] = useState<{ key: string; nonce: number } | null>(null);
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
  const build = useMemo(() => buildStages(data.maps, combined), [data.maps, combined]);
  const building = useRef(false);
  useEffect(() => {
    if (phase === 'first' || phase === 'waiting') building.current = true;
    else if (building.current && scene.areas.length > 0) {
      building.current = false;
      setRevealNonce((n) => n + 1);
    }
  }, [phase, scene.areas.length]);

  const groups = useGroups(data.maps);
  const sheetIndex = sheetKey ? (scene.fileByKey.get(sheetKey) ?? null) : null;
  const flagged = useMemo(() => {
    const files = new Set<number>();
    if (!data.unmatched || !unmatchedOpen) return files;
    for (const route of data.unmatched.routes) {
      const index = scene.fileByKey.get(fileKey(route.projectId, route.file));
      if (index !== undefined) files.add(index);
    }
    return files;
  }, [data.unmatched, unmatchedOpen, scene]);
  const showUnmatched = combined && data.unmatched !== null && unmatchedOpen && !pathOpen;
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
  const counts = useMemo(
    () => ({
      categories: scene.areas.length > 0 ? categoryCounts(scene) : null,
      kinds: kindCounts(scene),
    }),
    [scene],
  );
  const skeleton = data.pending || (scene.areas.length === 0 && phase !== 'failed');

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

  const goToFile = (projectId: string, path: string) => {
    if (view === 'focus') {
      setFocus({ projectId, path });
      return;
    }
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
  const skyTargets = useMemo<SkyTargets>(
    () => ({ fly: flyTarget, area: areaTarget }),
    [flyTarget, areaTarget],
  );
  const treeReveal = useMemo<TreeReveal | null>(() => {
    if (flyTarget && (!areaTarget || flyTarget.nonce > areaTarget.nonce)) {
      const file = scene.files[flyTarget.file]!;
      return {
        area: scene.areas[file.areaIndex]!.key,
        file: flyTarget.file,
        nonce: flyTarget.nonce,
      };
    }
    return areaTarget ? { area: areaTarget.key, nonce: areaTarget.nonce } : null;
  }, [flyTarget, areaTarget, scene]);
  const outlineReveal = useMemo<OutlineReveal | null>(() => {
    if (!treeReveal) return null;
    if (treeReveal.file === undefined) return { area: treeReveal.area, nonce: treeReveal.nonce };
    const file = scene.files[treeReveal.file]!;
    return {
      area: treeReveal.area,
      file: { projectId: file.projectId, path: file.path },
      nonce: treeReveal.nonce,
    };
  }, [treeReveal, scene]);

  const openFile = useCallback(
    (index: number) => {
      setSheetKey(scene.files[index]!.key);
      setReviewOpen(false);
    },
    [scene],
  );
  const focusOn = useCallback(
    (target: FocusTarget) => {
      setFocus(target);
      setView('focus');
      setSheetKey(null);
    },
    [setView],
  );
  const focusFile = useCallback(
    (index: number) => {
      const file = scene.files[index]!;
      focusOn({ projectId: file.projectId, path: file.path });
    },
    [scene, focusOn],
  );
  const showArea = (key: string) => {
    if (view === 'focus') setView('tree');
    setAreaTarget({ key, nonce: Date.now() });
  };

  const pickUnmatched = (endpoint: MapUnmatchedEndpoint) =>
    goToFile(endpoint.projectId, endpoint.file);
  const legendShown = (legend ?? (!combined && !phone)) && !pathOpen && !skeleton;
  const fileCount = data.maps.reduce((sum, map) => sum + (map.status?.fileCount ?? 0), 0);
  const names = data.projects.map((p) => p.name).join(' and ');
  const skyLabel = combined
    ? `Combined map of ${names}: ${scene.areas.length} areas, ${data.bridges.length} links.`
    : `Project map of ${data.projects[0]?.name ?? 'your project'}: ${scene.areas.length} areas as constellations.`;
  const treeLabel = `Tree of ${names || 'your project'}: ${groups.length} groups, ${scene.areas.length} areas.`;
  const treeSource = useViewSource({
    data,
    groups,
    filters,
    changed: lit.changed,
    changes: changesOn ? chatChanges : null,
    combined,
  });
  const versions = useMemo(
    () => new Map(data.maps.map((map) => [map.projectId, map.status?.builtAt ?? ''])),
    [data.maps],
  );

  const listView = projectListView(projectList);
  if (listView === 'unreachable') {
    return (
      <MapUnreachable
        retrying={projectList.isFetching}
        onRetry={() => void projectList.refetch()}
      />
    );
  }
  if (listView === 'empty') return <MapEmpty />;

  const stageView = (current: MapViewId) => {
    if (current === 'sky') {
      return (
        <SkyView
          scene={scene}
          bridges={data.bridges}
          combined={combined}
          filters={filters}
          lit={lit}
          sheetIndex={sheetIndex}
          flagged={flagged}
          flagHover={flagHover}
          inset={inset}
          building={skeleton ? buildProgress(data.maps) : null}
          label={skyLabel}
          legend={legendShown}
          bounds={bounds}
          revealNonce={revealNonce}
          targets={skyTargets}
          require={require}
          want={data.want}
          onFile={openFile}
          onCloseSheet={() => setSheetKey(null)}
          onPath={setPathOpen}
          onLegendHide={() => setLegend(false)}
          onRevealed={(shown, total, last) => setRevealed({ shown, total, last })}
          announce={setAnnouncement}
        />
      );
    }
    if (skeleton) return <ViewSkeleton view={current} />;
    if (current === 'tree') {
      return (
        <Suspense fallback={<ViewSkeleton view="tree" />}>
          <TreeView
            source={treeSource}
            label={treeLabel}
            reveal={treeReveal}
            require={require}
            onFile={openFile}
            onFocusFile={focusFile}
            announce={setAnnouncement}
          />
        </Suspense>
      );
    }
    if (current === 'outline') {
      return (
        <OutlineView
          source={treeSource}
          label={`Outline of ${names || 'your project'}`}
          reveal={outlineReveal}
          require={require}
          onFile={openFile}
          onFocusFile={focusFile}
        />
      );
    }
    return (
      <FocusView
        scene={scene}
        target={focus}
        versions={versions}
        onFocus={setFocus}
        onDetails={(target) => {
          setSheetKey(fileKey(target.projectId, target.path));
          setFind({
            wanted: { projectId: target.projectId, paths: [target.path] },
            nonce: Date.now(),
          });
        }}
      />
    );
  };

  return (
    <main className="page map" aria-label="Project map">
      <MapHeader
        projects={projects}
        selected={selected}
        chosen={data.projects}
        maps={data.maps}
        build={build}
        searchRef={searchRef}
        view={view}
        onView={setView}
        changes={{
          on: changesOn,
          count: changesOn ? lit.changed.size : null,
          chat: chatChanges.chat?.title ?? null,
        }}
        dependents={dependentsOn}
        reviewOpen={reviewOpen}
        toCheck={scene.areas.filter((entry) => needsCheck(entry.area)).length}
        onProjects={(ids) => {
          choose(ids);
          setSheetKey(null);
          setFocus(null);
        }}
        kindOf={(projectId, path) => {
          const index = scene.fileByKey.get(fileKey(projectId, path));
          return index === undefined ? null : scene.files[index]!.kind;
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
        categoryCounts={counts.categories}
        kindCounts={counts.kinds}
        bridges={combined ? data.bridges : null}
        unmatched={data.unmatched ? data.unmatched.routeTotal + data.unmatched.callTotal : null}
        unmatchedOpen={unmatchedOpen}
        legend={view === 'sky' ? legendShown : null}
        onFilters={setFilters}
        onUnmatched={() => setUnmatchedOpen((open) => !open)}
        onLegend={() => setLegend(!legendShown)}
      />
      <div className="map-stage" ref={stageRef} data-view={view}>
        {stageView(view)}
        <div className="sr-only" aria-live="polite">
          {announcement}
        </div>
        {!tips.dismissed.includes(view) && !skeleton && (
          <ViewTip view={view} onDismiss={() => tips.dismiss(view)} />
        )}
        {data.maps.length > 0 && (
          <SparkSay
            maps={data.maps}
            phase={phase}
            build={build}
            revealed={view === 'sky' ? revealed : null}
          />
        )}
        {showUnmatched && data.unmatched && (
          <UnmatchedPanel
            unmatched={data.unmatched}
            onPick={pickUnmatched}
            onHover={(endpoint) =>
              setFlagHover(endpoint ? fileKey(endpoint.projectId, endpoint.file) : null)
            }
            onClose={() => setUnmatchedOpen(false)}
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
            onFocus={() => focusFile(sheetIndex)}
            onOpenInChat={onOpenInChat}
            onCopied={() => toaster.show({ text: 'Path copied' })}
          />
        )}
        {reviewOpen && (
          <ReviewAreas
            items={scene.areas.map((entry) => ({
              key: entry.key,
              area: entry.area,
              projectName: combined
                ? (data.projects.find((p) => p.id === entry.projectId)?.name ?? null)
                : null,
            }))}
            fileCount={fileCount}
            onClose={() => setReviewOpen(false)}
            onShow={(key) => {
              if (phone) setReviewOpen(false);
              showArea(key);
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
