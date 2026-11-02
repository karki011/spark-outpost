import { BlobScout } from '../brand/BlobScout.tsx';
import {
  AskIcon,
  ExternalLinkIcon,
  GearIcon,
  HomeIcon,
  PlusIcon,
  SoundIcon,
} from '../ui/icons.tsx';
import type { Panel } from './island-model.ts';
import type { IslandSound } from './island-sound.ts';

export const PANEL_ORDER: readonly Panel[] = ['home', 'ask', 'quick'];

export interface BarActions {
  sound: IslandSound | null;
  onSettings: (() => void) | null;
  onOpenSpark: () => void;
}

export interface BarCounts {
  waiting: number;
  running: number;
}

interface IslandBarProps {
  panel: Panel;
  counts: BarCounts;
  actions: BarActions;
  onTab: (panel: Panel) => void;
}

function homeLabel(waiting: number): string {
  return waiting > 0 ? `Home, ${waiting} need you` : 'Home';
}

export function IslandBar({ panel, counts, actions, onTab }: IslandBarProps) {
  return (
    <div className="isl-topbar">
      <div className="isl-tabs" role="group" aria-label="Spark Island">
        <button
          type="button"
          className="isl-tab home"
          aria-pressed={panel === 'home'}
          aria-label={homeLabel(counts.waiting)}
          title="Home · ⌘1"
          onClick={() => onTab('home')}
        >
          <BlobScout size={18} />
          <HomeIcon />
          {counts.waiting > 0 && (
            <span className="isl-tab-count" aria-hidden="true">
              {counts.waiting}
            </span>
          )}
        </button>
        <button
          type="button"
          className="isl-tab"
          aria-pressed={panel === 'ask'}
          aria-label="Ask Spark"
          title="Ask Spark · ⌘3"
          onClick={() => onTab('ask')}
        >
          <AskIcon />
        </button>
        <button
          type="button"
          className="isl-tab"
          aria-pressed={panel === 'quick'}
          aria-label="New chat"
          title="New chat · ⌘2"
          onClick={() => onTab('quick')}
        >
          <PlusIcon />
        </button>
      </div>
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
      <button
        type="button"
        className="isl-ibtn"
        aria-label="Open Spark"
        title="Open Spark · ⌘O"
        onClick={actions.onOpenSpark}
      >
        <ExternalLinkIcon />
      </button>
    </div>
  );
}
