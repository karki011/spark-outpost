import type { ReactNode } from 'react';
import { useTooltip } from '../ui/Tooltip.tsx';
import type { PaneKeys } from './pane-shortcuts.ts';

interface ToolButtonProps {
  label: string;
  keys?: PaneKeys;
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
  children: ReactNode;
}

export function ToolButton({
  label,
  keys,
  disabled = false,
  pressed,
  onClick,
  children,
}: ToolButtonProps) {
  const tip = useTooltip(label, keys ? { side: 'top', keys: keys.shown } : { side: 'top' });
  return (
    <>
      <button
        type="button"
        className="icon-btn bp-tool"
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={keys?.aria}
        disabled={disabled}
        {...tip.triggerProps}
        onClick={onClick}
      >
        {children}
      </button>
      {tip.tooltip}
    </>
  );
}
