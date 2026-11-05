import './tab-basics.css';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  browserPipResultSchema,
  browserZoomPercent,
  type BrowserPaneTab,
  type BrowserPipResult,
  type BrowserZoomStep,
} from '@spark-outpost/contracts';
import { DotsIcon } from '../ui/icons.tsx';
import { Keys } from '../ui/Keys.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { useMenuPosition } from '../ui/use-menu-position.ts';
import { usePopover } from '../ui/use-popover.ts';
import { ZoomIcon } from './BrowserIcons.tsx';
import { PANE_KEYS, type PaneCommands, type PaneKeys } from './pane-shortcuts.ts';

const ROW_HEIGHT = 36;
const ITEMS = '[role="menuitem"]:not(:disabled)';

const PIP_NOTICE: Partial<Record<BrowserPipResult['pip'], string>> = {
  no_video: 'No video is playing on this page. A video inside an embed can’t be used.',
  refused: 'This page’s video can’t open in Picture in Picture.',
};

interface PageToolsProps {
  tab: BrowserPaneTab | null;
  commands: PaneCommands;
  onNotice(notice: string): void;
}

interface Item {
  id: string;
  label: string;
  keys?: PaneKeys;
  disabled?: boolean;
  run(tab: BrowserPaneTab): void;
}

function pageItems(commands: PaneCommands, tab: BrowserPaneTab, notice: (text: string) => void) {
  const zoom = (step: BrowserZoomStep) => (shown: BrowserPaneTab) =>
    commands.send({ command: 'zoom', tabId: shown.id, step });
  const pip = async (shown: BrowserPaneTab) => {
    const answer = await commands.ask({ command: 'pip', tabId: shown.id }).catch(() => null);
    const result = browserPipResultSchema.safeParse(answer);
    const text = PIP_NOTICE[result.data?.pip ?? 'refused'];
    if (text) notice(text);
  };
  const items: Item[] = [
    { id: 'in', label: 'Zoom In', keys: PANE_KEYS.zoomIn, run: zoom('in') },
    { id: 'out', label: 'Zoom Out', keys: PANE_KEYS.zoomOut, run: zoom('out') },
    { id: 'reset', label: 'Actual Size', keys: PANE_KEYS.zoomReset, run: zoom('reset') },
    {
      id: 'mute',
      label: tab.muted ? 'Unmute Tab' : 'Mute Tab',
      run: (shown) => commands.send({ command: 'mute', tabId: shown.id, muted: !shown.muted }),
    },
    {
      id: 'pip',
      label: 'Picture in Picture',
      disabled: tab.driving,
      run: (shown) => void pip(shown),
    },
    {
      id: 'print',
      label: 'Print…',
      keys: PANE_KEYS.print,
      disabled: tab.driving,
      run: (shown) => commands.send({ command: 'print', tabId: shown.id }),
    },
  ];
  return items;
}

export function PageTools({ tab, commands, onNotice }: PageToolsProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const position = useMenuPosition({ open, anchorRef, panelRef, wantedHeight: ROW_HEIGHT * 6 });
  const tip = useTooltip('Page tools', { side: 'top' });
  const menuId = useId();
  const page = tab !== null && tab.url !== '' && tab.error === null;
  const items = page ? pageItems(commands, tab, onNotice) : [];

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>(ITEMS)?.focus();
  }, [open, panelRef]);

  const moveFocus = (delta: number) => {
    const all = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []);
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(index + delta + all.length) % all.length]?.focus();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="icon-btn bp-tool"
        aria-label="Page tools"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={!page}
        {...tip.triggerProps}
        onClick={toggle}
      >
        <DotsIcon />
      </button>
      {!open && tip.tooltip}
      {createPortal(
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label="Page tools"
          className={open ? 'choice-menu open page-tools' : 'choice-menu page-tools'}
          style={{ ...position, width: undefined }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
          }}
        >
          {open &&
            tab &&
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                aria-keyshortcuts={item.keys?.aria}
                onClick={() => {
                  setOpen(false);
                  anchorRef.current?.focus();
                  item.run(tab);
                }}
              >
                <span>
                  <b>{item.label}</b>
                </span>
                {item.keys && <Keys keys={item.keys.shown} />}
              </button>
            ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function ZoomBadge({ tab, commands }: Pick<PageToolsProps, 'tab' | 'commands'>) {
  const percent = browserZoomPercent(tab?.zoom ?? 1);
  const tip = useTooltip('Reset page zoom', { side: 'top', keys: PANE_KEYS.zoomReset.shown });
  if (!tab || tab.url === '' || tab.zoom === 1) return null;
  return (
    <>
      <button
        type="button"
        className="bp-zoom"
        aria-label={`Page zoom ${percent}. Reset to 100%`}
        aria-keyshortcuts={PANE_KEYS.zoomReset.aria}
        {...tip.triggerProps}
        onClick={() => commands.send({ command: 'zoom', tabId: tab.id, step: 'reset' })}
      >
        <ZoomIcon />
        <span>{percent}</span>
      </button>
      {tip.tooltip}
    </>
  );
}
