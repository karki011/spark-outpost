import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { InfoIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { MAP_CATEGORIES, type MapCategory } from '@spark-outpost/contracts';
import { LINK_KINDS, LINK_LABELS, type Bridge, type LinkKind } from './bridges.ts';
import { FILE_KINDS, FILE_KIND_LABELS, type FileKind } from './file-kind.ts';
import type { MapFilters as Filters } from './frame.ts';
import { KindDot } from './JevLabel.tsx';
import { CATEGORY_LABELS } from './map-model.ts';

interface MapFiltersProps {
  filters: Filters;
  categoryCounts: Record<MapCategory, number> | null;
  kindCounts: Record<FileKind, number> | null;
  bridges: readonly Bridge[] | null;
  unmatched: number | null;
  unmatchedOpen: boolean;
  legend: boolean | null;
  onFilters: (filters: Filters) => void;
  onUnmatched: () => void;
  onLegend: () => void;
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function picked<T>(set: ReadonlySet<T>, value: T, all: readonly T[], only: boolean): Set<T> {
  if (!only) return toggled(set, value);
  return set.size === 1 && set.has(value) ? new Set(all) : new Set([value]);
}

const ONLY_HINT = 'Shift-click to show only this';

interface ChipProps {
  pressed: boolean;
  color?: string;
  count?: number | null;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  hint?: string;
  children: ReactNode;
}

function Chip({ pressed, color, count, disabled = false, onClick, hint, children }: ChipProps) {
  return (
    <button
      type="button"
      className="map-chip"
      aria-pressed={pressed}
      disabled={disabled}
      title={hint}
      style={color ? ({ '--c': color } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children}
      {count !== null && count !== undefined && (
        <span className="map-n">{count.toLocaleString('en-US')}</span>
      )}
    </button>
  );
}

const LINE_STYLE: Record<LinkKind, string> = {
  http: '',
  graphql: 'dot',
  package: 'dash',
  env: 'dash',
};
const LINE_COLOR: Record<LinkKind, string> = {
  http: 'var(--map-bridge)',
  graphql: 'var(--map-event)',
  package: 'var(--map-types)',
  env: 'var(--muted)',
};

export function MapFilters(props: MapFiltersProps) {
  const { filters, onFilters, bridges } = props;
  const linkCount = (kind: LinkKind) =>
    (bridges ?? [])
      .filter((bridge) => bridge.kind === kind)
      .reduce((sum, b) => sum + b.links.length, 0);
  return (
    <div className="map-fbar" role="toolbar" aria-label="Map filters">
      <div className="map-fgroup" role="group" aria-label="Area type">
        <span>Areas</span>
        {MAP_CATEGORIES.map((category) => (
          <Chip
            key={category}
            pressed={filters.categories.has(category)}
            color="var(--map-gold)"
            count={props.categoryCounts?.[category] ?? null}
            hint={ONLY_HINT}
            onClick={(event) =>
              onFilters({
                ...filters,
                categories: picked(filters.categories, category, MAP_CATEGORIES, event.shiftKey),
              })
            }
          >
            <i className={`map-tier ${category}`} aria-hidden="true" />
            {CATEGORY_LABELS[category]}
          </Chip>
        ))}
      </div>
      <div className="map-fgroup" role="group" aria-label="File kind">
        <span>Files</span>
        {FILE_KINDS.map((kind) => (
          <Chip
            key={kind}
            pressed={filters.kinds.has(kind)}
            color={`var(--map-k-${kind})`}
            count={props.kindCounts?.[kind] ?? null}
            hint={ONLY_HINT}
            onClick={(event) =>
              onFilters({
                ...filters,
                kinds: picked(filters.kinds, kind, FILE_KINDS, event.shiftKey),
              })
            }
          >
            <KindDot kind={kind} />
            {FILE_KIND_LABELS[kind]}
          </Chip>
        ))}
      </div>
      {bridges && (
        <div className="map-fgroup" role="group" aria-label="Links between projects">
          <span>Links</span>
          {LINK_KINDS.map((kind) => (
            <Chip
              key={kind}
              pressed={filters.links.has(kind) && linkCount(kind) > 0}
              color={LINE_COLOR[kind]}
              count={linkCount(kind)}
              disabled={linkCount(kind) === 0}
              hint={ONLY_HINT}
              onClick={(event) =>
                onFilters({
                  ...filters,
                  links: picked(filters.links, kind, LINK_KINDS, event.shiftKey),
                })
              }
            >
              <i
                className={`map-line ${LINE_STYLE[kind]}`}
                style={{ '--c': LINE_COLOR[kind] } as CSSProperties}
                aria-hidden="true"
              />
              {LINK_LABELS[kind]}
            </Chip>
          ))}
          {props.unmatched !== null && (
            <Chip
              pressed={props.unmatchedOpen}
              color="var(--map-warm)"
              count={props.unmatched}
              onClick={props.onUnmatched}
            >
              Unmatched
            </Chip>
          )}
        </div>
      )}
      <span className="map-sp" />
      {props.legend !== null && <LegendButton shown={props.legend} onClick={props.onLegend} />}
    </div>
  );
}

function LegendButton({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  const { triggerProps, tooltip } = useTooltip(shown ? 'Hide the legend' : 'How to read the map');
  return (
    <>
      <button
        type="button"
        className="map-icon-btn map-legend-btn"
        aria-label="Legend"
        aria-pressed={shown}
        {...triggerProps}
        onClick={onClick}
      >
        <InfoIcon />
      </button>
      {tooltip}
    </>
  );
}
