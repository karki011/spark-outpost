import './companion.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { CompanionPanel } from './CompanionPanel.tsx';
import {
  companionFeed,
  companionMood,
  errorKey,
  runningDots,
  scoutMood,
  statusLabel,
  statusText,
  unseenErrors,
} from './companion-model.ts';
import { companionPrefs, useCompanionPrefs } from './companion-prefs.ts';
import { useCornerDrag } from './use-corner-drag.ts';
import { useCelebration, useThrottledAnnouncement } from './use-companion-signals.ts';

const HIDDEN_NOTICE =
  'Status companion hidden. Turn it back on in Settings, Spark, Around the app.';

interface StatusCompanionProps {
  chats: readonly ConversationSummary[];
  visible: boolean;
  onOpenChat: (chat: ConversationSummary) => void;
  onHome: () => void;
}

const badgeText = (count: number) => (count > 9 ? '9+' : String(count));

function RunningDots({ count }: { count: number }) {
  const dots = runningDots(count);
  return (
    <span className="cmp-run" aria-hidden="true">
      {typeof dots === 'string'
        ? dots
        : Array.from({ length: dots }, (_, index) => <i key={index} />)}
    </span>
  );
}

export function StatusCompanion({ chats, visible, onOpenChat, onHome }: StatusCompanionProps) {
  const prefs = useCompanionPrefs();
  const feed = companionFeed(chats);
  const celebrating = useCelebration(chats);
  const seenErrors = useMemo(() => new Set(prefs.seenErrors), [prefs.seenErrors]);
  const mood = companionMood(feed, { celebrating, seenErrors });
  const failed = unseenErrors(feed, seenErrors).length;
  const shown = visible && !prefs.hidden;
  const announcement = useThrottledAnnouncement(statusText(feed), shown);
  const pageHidden = usePageHidden();
  const [openState, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  if (openState && !shown) setOpen(false);
  const open = openState && shown;
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { rootRef, dragging, moveTo, consumeDrag, handlers } = useCornerDrag(
    prefs.corner,
    companionPrefs.setCorner,
  );
  const label = statusLabel(feed);
  const tip = useTooltip(statusText(feed), {
    side: prefs.corner.startsWith('top') ? 'bottom' : 'top',
  });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, rootRef]);

  const toggle = () => {
    if (consumeDrag()) return;
    if (!open) companionPrefs.markErrorsSeen(feed.errors.map((item) => errorKey(item.chat)));
    setNotice('');
    setOpen(!open);
  };

  const openChat = (chat: ConversationSummary) => {
    setOpen(false);
    onOpenChat(chat);
  };

  const hide = () => {
    setOpen(false);
    companionPrefs.setHidden(true);
    setNotice(HIDDEN_NOTICE);
  };

  return (
    <>
      <div className="sr-only cmp-live" aria-live="polite">
        {notice || announcement}
      </div>
      {shown && (
        <div
          ref={rootRef}
          className="cmp"
          data-corner={prefs.corner}
          data-mood={mood}
          data-celebrate={celebrating || undefined}
          data-dragging={dragging || undefined}
          data-paused={pageHidden || undefined}
        >
          <button
            ref={buttonRef}
            type="button"
            className="cmp-btn"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            {...tip.triggerProps}
            {...handlers}
            onPointerDown={(event) => {
              tip.triggerProps.onPointerDown();
              handlers.onPointerDown(event);
            }}
            onClick={toggle}
          >
            <span className="cmp-hop">
              <span className="cmp-float">
                <BlobScout mood={scoutMood(mood)} size={36} className="cmp-scout" />
              </span>
            </span>
            {failed > 0 && (
              <span className="cmp-fail" aria-hidden="true">
                !
              </span>
            )}
            {feed.running.length > 0 && <RunningDots count={feed.running.length} />}
            {feed.needs.length > 0 && (
              <span key={feed.needs.length} className="cmp-badge" aria-hidden="true">
                {badgeText(feed.needs.length)}
              </span>
            )}
          </button>
          {!open && !dragging && tip.tooltip}
          {open && (
            <CompanionPanel
              ref={panelRef}
              id={panelId}
              feed={feed}
              corner={prefs.corner}
              onOpenChat={openChat}
              onCorner={moveTo}
              onHome={() => {
                setOpen(false);
                onHome();
              }}
              onHide={hide}
            />
          )}
        </div>
      )}
    </>
  );
}
