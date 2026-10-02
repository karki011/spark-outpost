import type { CSSProperties, ReactNode } from 'react';
import { CommentIcon, GearIcon, HomeIcon, PlusIcon, SoundIcon } from '../ui/icons.tsx';
import type { Panel } from './island-model.ts';
import type { IslandSound } from './island-sound.ts';

type Tab = 'home' | 'sessions' | 'new';

const TABS: { id: Tab; label: string; panel: Panel; icon: ReactNode; keys: string }[] = [
  { id: 'home', label: 'Home', panel: 'home', icon: <HomeIcon />, keys: '⌘1' },
  { id: 'sessions', label: 'Chats', panel: 'sessions', icon: <CommentIcon />, keys: '⌘2' },
  { id: 'new', label: 'New chat', panel: 'quick', icon: <PlusIcon />, keys: '⌘3' },
];

export const PANEL_ORDER: readonly Panel[] = ['home', 'sessions', 'quick', 'ask'];

function tabOf(panel: Panel): Tab {
  return panel === 'quick' || panel === 'ask' ? 'new' : panel;
}

export interface BarActions {
  sound: IslandSound | null;
  onSettings: (() => void) | null;
}

interface IslandBarProps {
  panel: Panel;
  waiting: number;
  actions: BarActions;
  onTab: (panel: Panel) => void;
}

function NewModes({ panel, onTab }: { panel: Panel; onTab: (panel: Panel) => void }) {
  return (
    <div className="isl-modes" role="group" aria-label="Start something">
      <button type="button" aria-pressed={panel === 'quick'} onClick={() => onTab('quick')}>
        Chat
      </button>
      <button type="button" aria-pressed={panel === 'ask'} onClick={() => onTab('ask')}>
        Ask Spark
      </button>
    </div>
  );
}

export function IslandBar({ panel, waiting, actions, onTab }: IslandBarProps) {
  const current = tabOf(panel);
  const index = TABS.findIndex((tab) => tab.id === current);
  return (
    <div className="isl-topbar">
      <div
        className="isl-tabs"
        role="tablist"
        aria-label="Spark Island"
        style={{ '--tab-i': index } as CSSProperties}
      >
        {TABS.map((tab) => {
          const label =
            tab.id === 'sessions' && waiting > 0 ? `${tab.label}, ${waiting} need you` : tab.label;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="isl-tab"
              aria-selected={tab.id === current}
              aria-label={label}
              title={`${tab.label} · ${tab.keys}`}
              onClick={() => tab.id !== current && onTab(tab.panel)}
            >
              {tab.icon}
              {tab.id === 'sessions' && waiting > 0 && (
                <span className="isl-badge" aria-hidden="true">
                  {waiting}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {current === 'new' && <NewModes panel={panel} onTab={onTab} />}
      <span className="isl-sp" />
      {actions.onSettings && (
        <button
          type="button"
          className="isl-ibtn"
          aria-label="Spark Island settings"
          title="Spark Island settings"
          onClick={actions.onSettings}
        >
          <GearIcon />
        </button>
      )}
      {actions.sound && (
        <button
          type="button"
          className="isl-ibtn"
          aria-label="Island chimes"
          aria-pressed={actions.sound.on}
          title={actions.sound.on ? 'Chimes on' : 'Chimes off'}
          onClick={actions.sound.toggle}
        >
          <SoundIcon on={actions.sound.on} />
        </button>
      )}
    </div>
  );
}
