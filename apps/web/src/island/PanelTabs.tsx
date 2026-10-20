import { ChevronIcon, GearIcon, PlusIcon, SoundIcon } from '../ui/icons.tsx';
import type { Panel } from './island-model.ts';
import { Kbd } from './island-parts.tsx';
import type { IslandSound } from './island-sound.ts';

export const PANEL_ORDER: readonly Panel[] = ['home', 'quick', 'ask'];

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

function Pills({ counts }: { counts: BarCounts }) {
  return (
    <span className="isl-pills" role="status">
      {counts.waiting > 0 && <span className="isl-pill wait">{counts.waiting} need you</span>}
      {counts.running > 0 && <span className="isl-pill run">{counts.running} running</span>}
    </span>
  );
}

export function IslandBar({ panel, counts, actions, onTab }: IslandBarProps) {
  const home = panel === 'home';
  return (
    <div className="isl-topbar">
      {home ? (
        <Pills counts={counts} />
      ) : (
        <>
          <button
            type="button"
            className="isl-ibtn isl-back"
            aria-label="Back to the inbox"
            title="Inbox · ⌘1"
            onClick={() => onTab('home')}
          >
            <ChevronIcon />
          </button>
          <NewModes panel={panel} onTab={onTab} />
        </>
      )}
      <span className="isl-sp" />
      {home && (
        <button
          type="button"
          className="isl-ibtn"
          aria-label="New chat"
          title="New chat · ⌘2"
          onClick={() => onTab('quick')}
        >
          <PlusIcon />
        </button>
      )}
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
      <button type="button" className="isl-open-spark" onClick={actions.onOpenSpark}>
        Open Spark <Kbd>⌘O</Kbd>
      </button>
    </div>
  );
}
