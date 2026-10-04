import { useEffect } from 'react';
import { BROWSER_KEYS } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { GlobeIcon } from './BrowserIcons.tsx';

interface BrowserButtonProps {
  open: boolean;
  onToggle(): void;
}

export function isBrowserShortcut(event: KeyboardEvent): boolean {
  const modifier = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && event.shiftKey && !event.altKey && event.code === 'KeyB';
}

export function BrowserButton({ open, onToggle }: BrowserButtonProps) {
  const tip = useTooltip('Browser', { keys: BROWSER_KEYS });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBrowserShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onToggle();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onToggle]);

  return (
    <>
      <button
        type="button"
        className="icon-btn browser-btn"
        aria-label="Browser"
        aria-pressed={open}
        aria-keyshortcuts={MAC ? 'Meta+Shift+B' : 'Control+Shift+B'}
        aria-controls="work-panel"
        {...tip.triggerProps}
        onClick={onToggle}
      >
        <GlobeIcon />
      </button>
      {tip.tooltip}
    </>
  );
}
