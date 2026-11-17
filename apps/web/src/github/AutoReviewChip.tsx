import { useEffect, useId } from 'react';
import { requestSettings } from '../settings/settings-request.ts';
import { openSparksPage } from '../sparks-page/sparks-route.ts';
import { ChevronIcon, PauseIcon, SparkleIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { chipLabel, reviewerLabel } from './auto-review-model.ts';
import { AutoReviewControls } from './AutoReviewControls.tsx';
import { useReviewSettings } from './use-review-settings.ts';

const FOCUSABLE = '[role="option"][tabindex="0"], button:not(:disabled)';

export function AutoReviewChip() {
  const panelId = useId();
  const titleId = useId();
  const { settings } = useReviewSettings();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const label = chipLabel(settings);
  const on = settings?.autoReview ?? false;
  const name = settings ? reviewerLabel(settings) : null;

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open, panelRef]);

  const closeAnd = (next: () => void) => {
    setOpen(false);
    next();
  };

  return (
    <div className="ar-chip-wrap">
      <button
        ref={anchorRef}
        type="button"
        className="ar-chip"
        data-on={on || undefined}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {on ? <SparkleIcon /> : <PauseIcon />}
        <span className="ar-chip-text" aria-hidden="true">
          <span className="ar-chip-word">Auto-review</span>
          <span className="ar-chip-state">{on ? ' on' : ' off'}</span>
          {name && <span className="ar-chip-name"> · {name}</span>}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} className="ar-pop">
          <h3 id={titleId} className="ar-pop-title">
            Auto-review
          </h3>
          <AutoReviewControls onOpenSparks={() => closeAnd(() => openSparksPage())} />
          <button
            type="button"
            className="ar-pop-link"
            onClick={() => closeAnd(() => requestSettings('pulls'))}
          >
            GitHub settings…
          </button>
        </div>
      )}
    </div>
  );
}
