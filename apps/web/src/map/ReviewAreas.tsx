import { useEffect, useRef } from 'react';
import { MAP_CATEGORIES, type MapArea, type MapCategory } from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { XIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { Confidence } from './JevLabel.tsx';
import { CATEGORY_LABELS, labelSource, needsCheck, reviewOrder } from './map-model.ts';

export interface ReviewItem {
  key: string;
  projectName: string | null;
  area: MapArea;
}

interface ReviewAreasProps {
  items: readonly ReviewItem[];
  fileCount: number;
  onClose: () => void;
  onShow: (key: string) => void;
  onCategory: (key: string, category: MapCategory | null) => void;
}

const OPTIONS = MAP_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] }));

export function ReviewAreas({ items, fileCount, onClose, onShow, onCategory }: ReviewAreasProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  const order = reviewOrder(items.map((item) => item.area));
  const sorted = order.map((area) => items.find((item) => item.area === area)!);
  return (
    <aside
      className="map-review"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-review-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="map-rv-head">
        <div>
          <h2 id="map-review-title" ref={titleRef} tabIndex={-1}>
            Review areas
          </h2>
          <p>
            Jev grouped {fileCount.toLocaleString('en-US')} files into {items.length} areas. Mark
            each one Core, Shared or Feature if Jev got it wrong. The map redraws as you go. Least
            sure first.
          </p>
        </div>
        <button type="button" className="map-icon-btn" aria-label="Close review" onClick={onClose}>
          <XIcon />
        </button>
      </header>
      <ul className="map-rv-list">
        {sorted.map(({ key, area, projectName }) => {
          const yours = area.categorySource === 'override';
          return (
            <li key={key} className="map-rv-item">
              <div className="map-rv-name">
                <button
                  type="button"
                  aria-label={`Show ${area.name} on the map`}
                  onClick={() => onShow(key)}
                >
                  {area.name}
                </button>
                <span className="map-n">{area.fileCount}</span>
                {yours ? (
                  <span className="map-you">You</span>
                ) : (
                  needsCheck(area) && <span className="map-check-tag">Check this</span>
                )}
              </div>
              <div className="map-rv-meta">
                <span className="map-jev">
                  {area.categorySource === 'jev' && <ProviderBlob providerId="jev" size={14} />}
                  {projectName ? `${projectName} · ` : ''}
                  {labelSource(area)}: {CATEGORY_LABELS[area.category]}
                </span>
                {area.confidence !== null && (
                  <span className="map-meter" aria-hidden="true">
                    <i style={{ width: `${area.confidence * 100}%` }} />
                  </span>
                )}
                <Confidence area={area} />
                {yours && (
                  <button type="button" className="map-undo" onClick={() => onCategory(key, null)}>
                    Use Jev’s
                  </button>
                )}
              </div>
              <Segmented
                ariaLabel={`${area.name} is`}
                options={OPTIONS}
                value={area.category}
                onChange={(id) => {
                  if (id !== area.category) onCategory(key, id as MapCategory);
                }}
              />
            </li>
          );
        })}
      </ul>
      <p className="map-rv-foot">
        Your choices are kept for this project and win over Jev’s next build. Core areas glow
        brightest on the map.
      </p>
    </aside>
  );
}
