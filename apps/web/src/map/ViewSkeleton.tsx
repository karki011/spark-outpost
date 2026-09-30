import type { MapViewId } from './map-views.ts';

const COLUMNS = [3, 4, 2];
const ROWS = [64, 48, 72, 40, 58, 66, 44, 52];

export function ViewSkeleton({ view }: { view: MapViewId }) {
  if (view === 'tree') {
    return (
      <div className="map-tree-skel" role="img" aria-label="The tree is loading">
        {COLUMNS.map((cards, column) => (
          <div key={column}>
            {Array.from({ length: cards }, (_, card) => (
              <span key={card}>
                <i className="map-sk" style={{ width: `${60 + ((column + card) % 3) * 12}%` }} />
                <i className="map-sk" style={{ width: '40%' }} />
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="map-skel-list" role="img" aria-label="The map is loading">
      {ROWS.map((width, row) => (
        <span key={row}>
          <i className="map-sk" style={{ width: `${width}%` }} />
        </span>
      ))}
    </div>
  );
}
