import type { ShortcutKeys } from '../ui/Keys.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';

interface ZoomButtonProps {
  label: string;
  keys: ShortcutKeys;
  path: string;
  onClick: () => void;
}

export function ZoomButton({ label, keys, path, onClick }: ZoomButtonProps) {
  const { triggerProps, tooltip } = useTooltip(label, { side: 'top', keys });
  return (
    <>
      <button type="button" aria-label={label} {...triggerProps} onClick={onClick}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {tooltip}
    </>
  );
}
