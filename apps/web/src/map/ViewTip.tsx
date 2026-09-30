import { XIcon } from '../ui/icons.tsx';
import { VIEW_LABELS, VIEW_TIPS, type MapViewId } from './map-views.ts';

export function ViewTip({ view, onDismiss }: { view: MapViewId; onDismiss: () => void }) {
  return (
    <aside
      className="map-tip map-glass"
      aria-label={`${VIEW_LABELS[view]} view tip`}
      data-map-overlay
    >
      <p>{VIEW_TIPS[view]}</p>
      <button type="button" className="map-icon-btn" aria-label="Dismiss tip" onClick={onDismiss}>
        <XIcon />
      </button>
    </aside>
  );
}
