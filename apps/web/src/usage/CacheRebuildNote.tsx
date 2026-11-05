import type { CacheRebuild } from '@spark-outpost/contracts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { REBUILD_TIP, rebuildText } from './cache-view.ts';
import './usage.css';

export function CacheRebuildNote({
  rebuild,
  className = '',
}: {
  rebuild: CacheRebuild | undefined;
  className?: string;
}) {
  const tip = useTooltip(REBUILD_TIP, { side: 'top' });
  if (!rebuild) return null;
  return (
    <>
      <span className={`cache-rebuild ${className}`.trim()} tabIndex={0} {...tip.triggerProps}>
        {rebuildText(rebuild)}
      </span>
      {tip.tooltip}
    </>
  );
}
