import '../sessions/session-palette.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BrowserFavorite, BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { browserHistoryApi, browserHistoryKey } from '../api/browser-history.ts';
import { recheckNativePlacement } from '../browser/use-view-placement.ts';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { ClockIcon, SearchIcon, SparkleIcon, XIcon } from '../ui/icons.tsx';
import { GlobeIcon } from '../browser/BrowserIcons.tsx';
import { Keys, type ShortcutKeys } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import {
  GROUP_TITLES,
  barRows,
  barSections,
  type BarAction,
  type BarGroup,
  type BarMode,
  type BarRow,
} from './command-bar-model.ts';
import { ProfileBadge } from './ProfileSwitch.tsx';

const GROUP_ICONS: Record<BarGroup, ReactNode> = {
  address: <GlobeIcon />,
  tabs: <GlobeIcon />,
  favorites: <GlobeIcon />,
  history: <ClockIcon />,
  actions: <SparkleIcon />,
};

export interface CommandBarProps {
  profile: BrowserProfile;
  mode: BarMode;
  tab: BrowserPaneTab | null;
  tabs: readonly BrowserPaneTab[];
  favorites: readonly BrowserFavorite[];
  onSelectTab(tabId: string): void;
  onOpen(url: string, newTab: boolean): void;
  onAction(action: BarAction): void;
  onClose(): void;
}

const HISTORY_DELAY_MS = 120;
const MOVE_KEYS: ShortcutKeys = ['↑', '↓'];
const OPEN_KEYS: ShortcutKeys = ['Enter'];
const NEW_TAB_KEYS: ShortcutKeys = MAC ? ['⌘', 'Enter'] : ['Ctrl', 'Enter'];
const CLOSE_KEYS: ShortcutKeys = ['Esc'];

function useHistory(profile: BrowserProfile, text: string) {
  const searched = useDebouncedValue(text.trim(), HISTORY_DELAY_MS);
  return useQuery({
    queryKey: [...browserHistoryKey, profile, searched],
    queryFn: ({ signal }) => browserHistoryApi.search(profile, searched, signal),
    placeholderData: keepPreviousData,
  });
}

function useOverlay() {
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    recheckNativePlacement();
    return () => {
      before?.focus({ preventScroll: true });
      requestAnimationFrame(recheckNativePlacement);
    };
  }, []);
}

export function CommandBar(props: CommandBarProps) {
  const { profile, mode, tab, onClose } = props;
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(mode === 'here' ? (tab?.url ?? '') : '');
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const history = useHistory(profile, typed ? text : '');
  const rows = barRows({
    text: typed ? text : '',
    tabs: props.tabs,
    favorites: props.favorites,
    history: history.data ?? [],
    page: tab !== null && tab.url !== '' && tab.error === null,
  });
  const sections = barSections(rows);
  const current = Math.min(active, Math.max(0, rows.length - 1));
  const optionId = (index: number) => `${id}-opt-${index}`;
  useOverlay();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  });

  const pick = (row: BarRow, newTab: boolean) => {
    onClose();
    const target = row.target;
    if (target.kind === 'tab') props.onSelectTab(target.tabId);
    else if (target.kind === 'open') props.onOpen(target.url, newTab || mode === 'new' || !tab);
    else props.onAction(target.action);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : rows.length - 1;
      setActive(rows.length === 0 ? 0 : (current + step) % rows.length);
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      const row = rows[current];
      if (row) pick(row, MAC ? event.metaKey : event.ctrlKey);
      return;
    }
    wrapTabFocus(event, () => [
      ...(panel.current?.querySelectorAll<HTMLElement>('input, button') ?? []),
    ]);
  };

  const label = mode === 'new' ? 'Open a new tab' : 'Go to';
  return (
    <div
      className="sp bv-bar-cmd"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="sp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        <div className="sp-head">
          <SearchIcon />
          <input
            ref={input}
            type="text"
            className="sp-input"
            role="combobox"
            aria-label={label}
            aria-expanded={rows.length > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={rows[current] ? optionId(current) : undefined}
            placeholder="Search tabs, favorites and history, or type an address"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setTyped(true);
              setActive(0);
            }}
          />
          <ProfileBadge profile={profile} />
          <button type="button" className="icon-btn sp-close" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="sp-list" id={`${id}-list`} role="listbox" aria-label={label}>
          {sections.map((section) => (
            <ul key={section.group} role="group" aria-labelledby={`${id}-${section.group}`}>
              <li className="sp-group" id={`${id}-${section.group}`} role="presentation">
                {GROUP_TITLES[section.group]}
              </li>
              {section.rows.map(({ row, index }) => (
                <li
                  key={row.key}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === current}
                  className={index === current ? 'sp-row act' : 'sp-row'}
                  onClick={(event) => pick(row, MAC ? event.metaKey : event.ctrlKey)}
                  onPointerMove={() => setActive(index)}
                >
                  <span className="bv-cmd-icon" aria-hidden="true">
                    {GROUP_ICONS[row.group]}
                  </span>
                  <span className="sp-main">
                    <span className="sp-title">{row.title}</span>
                    {row.detail && <span className="sp-where">{row.detail}</span>}
                  </span>
                  <span className="sp-side">
                    {row.target.kind === 'tab' && <span className="sp-state">Switch</span>}
                  </span>
                </li>
              ))}
            </ul>
          ))}
          {rows.length === 0 && <p className="sp-empty">Nothing matches.</p>}
        </div>
        <p className="sp-foot">
          <span aria-hidden="true">
            <Keys keys={MOVE_KEYS} /> move <Keys keys={OPEN_KEYS} /> open{' '}
            <Keys keys={NEW_TAB_KEYS} /> new tab <Keys keys={CLOSE_KEYS} /> close
          </span>
          <span className="bv-cmd-note">History stays on this Mac</span>
        </p>
      </div>
    </div>
  );
}
