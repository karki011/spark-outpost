import type { MapArea } from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { FILE_KIND_LABELS, type FileKind } from './file-kind.ts';
import { CATEGORY_LABELS, confidenceText, needsCheck } from './map-model.ts';

export function KindDot({ kind }: { kind: FileKind }) {
  return (
    <i className="map-kdot" style={{ background: `var(--map-k-${kind})` }} aria-hidden="true" />
  );
}

export function KindTag({ kind }: { kind: FileKind }) {
  return (
    <span className="map-kind">
      <KindDot kind={kind} />
      {FILE_KIND_LABELS[kind]}
    </span>
  );
}

export function Confidence({ area }: { area: MapArea }) {
  const text = confidenceText(area);
  if (text === null) return null;
  return <span className={needsCheck(area) ? 'map-conf low' : 'map-conf'}>{text}</span>;
}

export function JevLabel({ area, size = 16 }: { area: MapArea; size?: number }) {
  const who =
    area.categorySource === 'override' ? 'You' : area.categorySource === 'jev' ? null : 'Rules';
  return (
    <span className="map-jev">
      {who ? <span className="map-who">{who}</span> : <ProviderBlob providerId="jev" size={size} />}
      <span>
        {CATEGORY_LABELS[area.category]} · {area.name}
        {area.confidence !== null && ' · '}
        <Confidence area={area} />
      </span>
    </span>
  );
}
