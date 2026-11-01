import './view-stage.css';
import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { BrowserPaneTab, BrowserProfile, BrowserViewSplit } from '@spark-outpost/contracts';
import { ShowingIcon } from '../browser/BrowserIcons.tsx';
import { tabLabel } from '../browser/tab-label.ts';
import { useNativePlacement, type PlaceView } from '../browser/use-view-placement.ts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { SpinnerIcon } from '../ui/icons.tsx';
import { SplitDivider, useSplitRatio } from './SplitDivider.tsx';
import { sendViewCommand } from './view-store.ts';

export function StartPage({
  profile,
  tab,
}: {
  profile: BrowserProfile;
  tab: BrowserPaneTab | null;
}) {
  if (tab?.error) {
    return (
      <div className="bp-start" role="status">
        <b>This page didn’t load</b>
        <p>{tab.error}</p>
      </div>
    );
  }
  if (tab?.loading) {
    return (
      <div className="bp-start bv-loading" role="status">
        <SpinnerIcon />
        <b>Loading</b>
      </div>
    );
  }
  return (
    <div className="bp-start">
      <b>{profile === 'personal' ? 'Personal browser' : 'Work browser'}</b>
      <p>Type a web address on the left to open a page.</p>
      <p>
        {profile === 'personal'
          ? 'No agent, Ask Spark or paired device can open or act in these tabs, and your sign-ins here stay out of every chat. Ask Spark reads a tab’s text only when you @-mention it in a question.'
          : 'Work shares its sign-ins with every chat’s agent, so you can sign in for them or check what they see. Agents still can’t see these tabs until you hand one to a chat.'}
      </p>
    </div>
  );
}

interface PageSlotProps {
  profile: BrowserProfile;
  tab: BrowserPaneTab;
  image: string | null;
}

function PageSlot({ profile, tab, image }: PageSlotProps) {
  const slot = useRef<HTMLDivElement>(null);
  const tabId = tab.id;
  const place = useCallback<PlaceView>(
    (bounds, covered) => void desktopBrowserView()?.placeSlot({ profile, tabId, bounds, covered }),
    [profile, tabId],
  );
  useNativePlacement(slot, true, place);
  const blank = tab.url === '' || tab.error !== null;
  return (
    <div className="bv-slot-page" ref={slot}>
      {blank && <StartPage profile={profile} tab={tab} />}
      {!blank && image && <img className="bp-snapshot" src={image} alt="" />}
    </div>
  );
}

function SplitSide({ profile, tab, image }: PageSlotProps) {
  const title = tabLabel(tab);
  return (
    <section className={tab.active ? 'bv-side-pane on' : 'bv-side-pane'} aria-label={title}>
      <div className="bv-side-bar">
        <button
          type="button"
          className="bv-side-title"
          aria-current={tab.active ? 'page' : undefined}
          title={tab.url || title}
          onClick={() => sendViewCommand(profile, { command: 'select', tabId: tab.id })}
        >
          <span>{title}</span>
        </button>
        {tab.active && (
          <span className="bv-side-status">
            <ShowingIcon />
            In use
          </span>
        )}
        <button
          type="button"
          className="icon-btn bv-side-close"
          aria-label={`Close ${title}`}
          onClick={() => sendViewCommand(profile, { command: 'close', tabId: tab.id })}
        >
          <CloseIcon />
        </button>
      </div>
      <PageSlot profile={profile} tab={tab} image={image} />
    </section>
  );
}

interface SplitStageProps {
  profile: BrowserProfile;
  split: BrowserViewSplit;
  tabs: readonly BrowserPaneTab[];
  images: Readonly<Record<string, string>>;
}

export function SplitStage({ profile, split, tabs, images }: SplitStageProps) {
  const { ratio, move, commit } = useSplitRatio(profile, split.ratio);
  const left = tabs.find((tab) => tab.id === split.leftTabId);
  const right = tabs.find((tab) => tab.id === split.rightTabId);
  if (!left || !right) return null;
  return (
    <div className="bv-split" style={{ '--bv-split': ratio } as CSSProperties}>
      <SplitSide key={left.id} profile={profile} tab={left} image={images[left.id] ?? null} />
      <SplitDivider ratio={ratio} move={move} commit={commit} />
      <SplitSide key={right.id} profile={profile} tab={right} image={images[right.id] ?? null} />
    </div>
  );
}

function usePeekEscape(close: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"]:not(.bv-peek), [role="menu"]')) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}

export function PeekPanel({ profile, tab, image }: PageSlotProps) {
  const close = () => sendViewCommand(profile, { command: 'peek_close' });
  usePeekEscape(close);
  const title = tabLabel(tab);
  return (
    <>
      <div className="bv-peek-scrim" aria-hidden="true" onClick={close} />
      <div className="bv-peek" role="dialog" aria-label={`Peek: ${title}`}>
        <div className="bv-peek-bar">
          <span className="bv-peek-title" title={tab.url || title}>
            {title}
          </span>
          <button
            type="button"
            className="btn bv-hand"
            onClick={() => sendViewCommand(profile, { command: 'peek_promote' })}
          >
            Open as tab
          </button>
          <button
            type="button"
            className="icon-btn bv-side-close"
            aria-label="Close Peek"
            title="Close Peek (Esc)"
            aria-keyshortcuts="Escape"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
        <PageSlot profile={profile} tab={tab} image={image} />
      </div>
    </>
  );
}
