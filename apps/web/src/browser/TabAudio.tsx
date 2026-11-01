import './tab-basics.css';
import type { BrowserPaneTab } from '@spark-outpost/contracts';
import { SoundIcon } from '../ui/icons.tsx';

interface TabAudioProps {
  tab: BrowserPaneTab;
  label: string;
  onMute(muted: boolean): void;
}

export function TabAudio({ tab, label, onMute }: TabAudioProps) {
  if (!tab.audible && !tab.muted) return null;
  const action = tab.muted ? `Unmute ${label}` : `Mute ${label}`;
  return (
    <button
      type="button"
      className="tab-audio"
      aria-label={action}
      aria-pressed={tab.muted}
      title={action}
      onClick={() => onMute(!tab.muted)}
    >
      <SoundIcon on={!tab.muted} />
      <span>{tab.muted ? 'Muted' : 'Playing'}</span>
    </button>
  );
}
