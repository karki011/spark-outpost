import './pane-width.css';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTooltip } from '../ui/Tooltip.tsx';
import { useMenuPosition } from '../ui/use-menu-position.ts';
import { usePopover } from '../ui/use-popover.ts';
import { holdTransitions, releaseAfterPaint } from '../ui/width-drag.ts';
import { PageWidthIcon } from './BrowserIcons.tsx';
import { measurePane, pageScale, type PaneMeasure } from './pane-room.ts';
import {
  PAGE_WIDTH_PRESETS,
  pageWidth,
  presetNotice,
  presetPaneWidth,
  shownPaneWidth,
} from './pane-width.ts';

const ROW_HEIGHT = 36;
const MENU_ITEMS = '[role="menuitemradio"]:not(:disabled)';

interface PageWidthMenuProps {
  setWidth(width: number): void;
  onNotice(notice: string): void;
}

interface Opened extends PaneMeasure {
  page: number;
  pane: HTMLElement;
  anchor: HTMLElement;
}

function measured(anchor: HTMLElement): Opened | null {
  const pane = anchor.closest<HTMLElement>('.wp');
  if (!pane) return null;
  const room = measurePane(pane);
  const measure = { ...room, zoom: pageScale(pane, room.zoom) };
  const shown = shownPaneWidth(pane.getBoundingClientRect().width, measure.range);
  return { ...measure, page: pageWidth(shown, measure.inset, measure.zoom), pane, anchor };
}

export function PageWidthMenu({ setWidth, onNotice }: PageWidthMenuProps) {
  const {
    open,
    setOpen,
    toggle: flip,
    anchorRef,
    panelRef,
  } = usePopover<HTMLButtonElement, HTMLDivElement>();
  const position = useMenuPosition({
    open,
    anchorRef,
    panelRef,
    wantedHeight: ROW_HEIGHT * (PAGE_WIDTH_PRESETS.length + 1),
  });
  const [opened, setOpened] = useState<Opened | null>(null);
  const tip = useTooltip('Page width', { side: 'top' });
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const checked = panel?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (checked ?? panel?.querySelector<HTMLButtonElement>(MENU_ITEMS))?.focus();
  }, [open, panelRef]);

  const toggle = (anchor: HTMLElement) => {
    if (!open) setOpened(measured(anchor));
    flip();
  };

  const choose = (page: number | 'fit') => {
    setOpen(false);
    if (!opened) return;
    const { pane, anchor } = opened;
    anchor.focus();
    const { range, inset, zoom } = measurePane(pane);
    const fit = presetPaneWidth(page, inset, range, pageScale(pane, zoom));
    if (!fit.ok) {
      onNotice(presetNotice(page as number, fit.widest));
      return;
    }
    const release = holdTransitions(pane);
    setWidth(fit.width);
    releaseAfterPaint(release);
  };

  const widest = opened ? pageWidth(opened.range.max, opened.inset, opened.zoom) : 0;
  const items = [
    ...PAGE_WIDTH_PRESETS.map((page) => ({
      id: String(page),
      label: `${page} px`,
      note: null,
      checked: opened?.page === page,
      disabled: page > widest,
      page: page as number | 'fit',
    })),
    {
      id: 'fit',
      label: 'Fit',
      note: `Widest that fits: ${widest} px`,
      checked: opened?.page === widest,
      disabled: false,
      page: 'fit' as const,
    },
  ];

  const moveFocus = (delta: number) => {
    const all = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS) ?? []);
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(index + delta + all.length) % all.length]?.focus();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="icon-btn bp-tool"
        aria-label="Page width"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        {...tip.triggerProps}
        onClick={(event) => toggle(event.currentTarget)}
      >
        <PageWidthIcon />
      </button>
      {!open && tip.tooltip}
      {createPortal(
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label="Page width"
          className={open ? 'choice-menu open bp-width-menu' : 'choice-menu bp-width-menu'}
          style={{ ...position, width: undefined }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
          }}
        >
          {open &&
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => choose(item.page)}
              >
                <span>
                  <b>{item.label}</b>
                  {item.note && <small>{item.note}</small>}
                </span>
                <svg className="tick" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m5 12 5 5 9-10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ))}
        </div>,
        document.body,
      )}
    </>
  );
}
