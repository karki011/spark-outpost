import type { CSSProperties, ReactNode } from 'react';
import { BackIcon, XIcon } from '../ui/icons.tsx';
import { FILE_KINDS, FILE_KIND_LABELS } from './file-kind.ts';
import { JevLabel, KindDot } from './JevLabel.tsx';
import { kindShares } from './map-model.ts';
import type { Scene } from './scene.ts';

export function AreaCrumb({
  scene,
  area,
  onBack,
}: {
  scene: Scene;
  area: number;
  onBack: () => void;
}) {
  const entry = scene.areas[area]!;
  const shares = kindShares(scene, area);
  const project =
    scene.projects.length > 1 ? scene.projects.find((p) => p.projectId === entry.projectId) : null;
  return (
    <div className="map-crumb map-glass">
      <button
        type="button"
        className="map-back"
        aria-label="Back to the whole sky"
        onClick={onBack}
      >
        <BackIcon />
      </button>
      <div>
        <h2>{entry.area.name}</h2>
        <div className="map-meta">
          {entry.area.fileCount} files{project ? ` · ${project.name}` : ''}
        </div>
      </div>
      <div
        className="map-kbar"
        role="img"
        aria-label={shares.map(([kind, count]) => `${count} ${FILE_KIND_LABELS[kind]}`).join(', ')}
      >
        {shares.map(([kind, count]) => (
          <i key={kind} style={{ flex: count, background: `var(--map-k-${kind})` }} />
        ))}
      </div>
      <JevLabel area={entry.area} />
    </div>
  );
}

const KIND_MEANING = {
  ui: 'UI: screens, components, styles',
  api: 'API and server logic',
  data: 'Data: schema, persistence, contracts',
  test: 'Tests, seeds and stubs',
  config: 'Config, scripts and build',
} as const;

function Row({ symbol, children }: { symbol: ReactNode; children: ReactNode }) {
  return (
    <li>
      <span className="map-sym" aria-hidden="true">
        {symbol}
      </span>
      <span>{children}</span>
    </li>
  );
}

function SkyRows({ combined }: { combined: boolean }) {
  return (
    <>
      <Row symbol={<i className="map-lg-star big" />}>
        Star size: files that depend on it, plus how often it changes
      </Row>
      <Row
        symbol={
          <svg width="22" height="10" viewBox="0 0 22 10">
            <path d="M2 8 11 3l9 4" stroke="var(--map-star-line)" strokeWidth="1.2" fill="none" />
            <circle cx="2" cy="8" r="2" fill="var(--map-star)" />
            <circle cx="11" cy="3" r="2.4" fill="var(--map-star)" />
            <circle cx="20" cy="7" r="1.6" fill="var(--map-star)" />
          </svg>
        }
      >
        Constellation: an area’s main files, joined by their imports
      </Row>
      <Row
        symbol={
          <svg width="22" height="6" viewBox="0 0 22 6">
            <path
              d="M1 3h20"
              stroke="var(--muted)"
              strokeWidth="1.2"
              strokeDasharray="2 4"
              strokeLinecap="round"
            />
          </svg>
        }
      >
        Faint line: imports between areas
      </Row>
      <Row symbol={<span className="map-lg-abc">ABC</span>}>
        Brighter areas are Core, dimmer are Feature
      </Row>
      {combined && (
        <Row
          symbol={
            <i className="map-line" style={{ '--c': 'var(--map-bridge)' } as CSSProperties} />
          }
        >
          Bridge: a call in one project and the code that answers it in another
        </Row>
      )}
      <Row symbol={<i className="map-lg-ring" />}>Changed in this chat</Row>
    </>
  );
}

function AreaRows() {
  return (
    <>
      {FILE_KINDS.map((kind) => (
        <Row key={kind} symbol={<KindDot kind={kind} />}>
          {KIND_MEANING[kind]}
        </Row>
      ))}
      <Row
        symbol={
          <svg width="22" height="8" viewBox="0 0 22 8">
            <path d="M1 4h20" stroke="var(--muted)" strokeWidth="1" />
          </svg>
        }
      >
        Line: one file imports the other
      </Row>
      <Row symbol={<i className="map-lg-star" />}>Bigger: more files depend on it</Row>
    </>
  );
}

export function MapLegend({
  area,
  combined,
  onHide,
}: {
  area: boolean;
  combined: boolean;
  onHide: () => void;
}) {
  return (
    <section className="map-legend map-glass" aria-labelledby="map-legend-title">
      <h3 id="map-legend-title">
        {area ? 'Area' : 'How to read the sky'}
        <button type="button" aria-label="Hide legend" onClick={onHide}>
          <XIcon />
        </button>
      </h3>
      <ul>{area ? <AreaRows /> : <SkyRows combined={combined} />}</ul>
    </section>
  );
}
