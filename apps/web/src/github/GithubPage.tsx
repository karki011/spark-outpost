import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  GithubInboxGroup,
  GithubInboxItem,
  GithubInboxProblem,
} from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { Glyph } from '../tickets/ticket-icons.tsx';
import { PanelResizer } from '../ui/PanelResizer.tsx';
import { useStoredPanelWidth, type PanelWidthLimits } from '../ui/panel-width.ts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { GithubDetail } from './GithubDetail.tsx';
import { GithubHeader } from './GithubHeader.tsx';
import { GithubList } from './GithubList.tsx';
import { GithubSearchList } from './GithubSearchList.tsx';
import { GithubTiles } from './GithubTiles.tsx';
import { defaultGroup, filterByProject, GROUPS, groupItems, isFresh } from './github-model.ts';
import { matchCounts, searchItems, searchTerms } from './github-search.ts';
import {
  initialPull,
  readRemembered,
  rememberOpen,
  SIDE_BY_SIDE_WIDTH,
} from './github-selection.ts';
import { useGithubInbox } from './use-github-inbox.ts';
import './github.css';
import './github-layout.css';
import './github-search.css';

const LIST_WIDTH: PanelWidthLimits = {
  key: 'spark.github.listWidth',
  min: 280,
  max: 720,
  fallback: 400,
};

interface GithubPageProps {
  onOpenChat: (conversationId: string) => void;
}

function ConnectGithub() {
  return (
    <div className="gh-empty">
      <span className="gh-big" aria-hidden="true">
        <Glyph name="pr" size={26} />
      </span>
      <h3>See your pull requests here</h3>
      <p>
        Connect GitHub and Spark sorts the pull requests that need you: reviews you were asked for,
        your own that need fixes, those ready to merge and those waiting on others.
      </p>
      <button type="button" className="btn primary" onClick={() => requestSettings('tools')}>
        Open Connectors
      </button>
    </div>
  );
}

function Problems({ problems }: { problems: GithubInboxProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <p className="gh-problems" role="status">
      <Glyph name="info" size={14} />
      <span>
        {problems
          .map((problem) =>
            problem.repo ? `${problem.repo}: ${problem.message}` : problem.message,
          )
          .join(' · ')}
      </span>
    </p>
  );
}

function useSideBySide(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    setWide((ref.current?.clientWidth ?? 0) > SIDE_BY_SIDE_WIDTH);
  }, [ref]);
  return wide;
}

function useSlashToSearch(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!searchRef.current) return;
      event.preventDefault();
      searchRef.current.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef]);
}

function focusRow(id: string) {
  document.querySelector<HTMLElement>(`.gh-main[data-id="${CSS.escape(id)}"]`)?.focus();
}

export function GithubPage({ onOpenChat }: GithubPageProps) {
  const { inbox, refresh, seen, windowDays } = useGithubInbox();
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<GithubInboxGroup | null>(null);
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [remembered] = useState(readRemembered);
  const pageRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sideBySide = useSideBySide(pageRef);
  useSlashToSearch(searchRef);
  const [listWidth, setListWidth] = useStoredPanelWidth(LIST_WIDTH);
  const shownWidth = { '--gh-list-w': `${listWidth ?? LIST_WIDTH.fallback}px` } as CSSProperties;
  const now = useMinuteClock();
  const data = inbox.data;

  const items = useMemo(() => filterByProject(data?.items ?? [], projectId), [data, projectId]);
  const grouped = useMemo(() => groupItems(items), [items]);
  const terms = useMemo(() => searchTerms(query), [query]);
  const matches = useMemo(() => searchItems(items, terms), [items, terms]);
  const searching = terms.length > 0;
  const autoOpen = sideBySide ? initialPull(grouped, remembered) : null;
  const shownId = openId === undefined ? (autoOpen?.id ?? null) : openId;
  const openItem = shownId ? items.find((item) => item.id === shownId) : undefined;
  const group =
    picked ?? (openId === undefined ? autoOpen?.group : undefined) ?? defaultGroup(grouped);

  const open = (item: GithubInboxItem) => {
    setOpenId(item.id);
    rememberOpen(item.id);
    if (isFresh(item)) seen.mutate({ id: item.id, headSha: item.headSha });
  };
  const close = () => {
    if (!openItem) return;
    const id = openItem.id;
    setOpenId(null);
    rememberOpen(null);
    focusRow(id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !openItem) return;
    if (document.querySelector('[aria-modal="true"], .choice-menu.open')) return;
    event.preventDefault();
    close();
  };
  const pickGroup = (next: GithubInboxGroup | null) => {
    setPicked(next);
    if (!searching) setOpenId(null);
  };
  const searchGroups = searching && picked ? [picked] : GROUPS;

  return (
    <main ref={pageRef} className="page gh" aria-labelledby="gh-title" onKeyDown={onKeyDown}>
      <GithubHeader
        connected={data?.connected ?? false}
        windowDays={data?.windowDays ?? 14}
        projects={projects.data ?? []}
        projectId={projectId}
        fetchedAt={data?.fetchedAt ?? null}
        refreshing={refresh.isPending}
        now={now}
        onWindow={(days) => windowDays.mutate(days)}
        onProject={(id) => {
          setProjectId(id);
          setOpenId(null);
        }}
        onRefresh={() => refresh.mutate()}
        query={query}
        searchRef={searchRef}
        onQuery={(next) => {
          setQuery(next);
          setPicked(null);
        }}
      />
      {data === undefined ? (
        <div className="gh-wait">
          <QueryWait query={inbox} what="your pull requests">
            <Skeleton label="Loading groups" shape="cards" rows={4} className="gh-skel-tiles" />
            <Skeleton label="Loading pull requests" shape="list" rows={6} />
          </QueryWait>
        </div>
      ) : !data.connected ? (
        <ConnectGithub />
      ) : (
        <>
          <Problems problems={data.problems} />
          <GithubTiles
            grouped={grouped}
            value={searching ? picked : group}
            matches={searching ? matchCounts(matches) : null}
            now={now}
            onChange={(next) => pickGroup(searching && next === picked ? null : next)}
          />
          {searching && (
            <p className="gh-search-note" role="status">
              {matches.length === 1
                ? '1 pull request matches'
                : `${matches.length} pull requests match`}{' '}
              “{query.trim()}”
            </p>
          )}
          <div className="gh-split" data-open={openItem ? '' : undefined}>
            <div className="gh-list-wrap" style={shownWidth}>
              <section className="gh-list" aria-label="Pull requests">
                {searching ? (
                  <GithubSearchList
                    matches={matches}
                    groups={searchGroups}
                    terms={terms}
                    openId={openItem?.id ?? null}
                    now={now}
                    onOpen={open}
                    onOpenChat={onOpenChat}
                  />
                ) : (
                  <GithubList
                    key={group}
                    group={group}
                    items={grouped[group]}
                    openId={openItem?.id ?? null}
                    now={now}
                    onOpen={open}
                    onOpenChat={onOpenChat}
                  />
                )}
              </section>
              {openItem && (
                <PanelResizer
                  className="gh-resize"
                  label="Resize pull request list"
                  panelSelector=".gh-list-wrap"
                  variable="--gh-list-w"
                  cap="--gh-list-cap"
                  side="right"
                  limits={LIST_WIDTH}
                  width={listWidth}
                  onWidth={setListWidth}
                />
              )}
            </div>
            {openItem && (
              <GithubDetail item={openItem} now={now} onClose={close} onOpenChat={onOpenChat} />
            )}
          </div>
        </>
      )}
    </main>
  );
}
