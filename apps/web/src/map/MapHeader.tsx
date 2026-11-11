import './map-toolbar.css';
import type { ReactNode, RefObject } from 'react';
import type { Project, ProjectMap } from '@spark-outpost/contracts';
import type { RepoFile } from '../chat/project/use-file-search.ts';
import { SparkleIcon, SpinnerIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import type { BuildStages } from './build-stages.ts';
import type { FileKind } from './file-kind.ts';
import { MAP_VIEWS, VIEW_LABELS, type MapViewId } from './map-views.ts';
import { MapSearch } from './MapSearch.tsx';
import { MapStatusPill } from './MapStatusPill.tsx';
import { RepoPicker } from './RepoPicker.tsx';

interface MapHeaderProps {
  projects: readonly Project[];
  selected: readonly string[];
  chosen: readonly Project[];
  maps: readonly ProjectMap[];
  build: BuildStages;
  searchRef: RefObject<HTMLInputElement | null>;
  view: MapViewId;
  onView: (view: MapViewId) => void;
  changes: { on: boolean; count: number | null; chat: string | null };
  dependents: boolean;
  running: { on: boolean; count: number };
  reviewOpen: boolean;
  toCheck: number;
  onProjects: (ids: string[]) => void;
  kindOf: (projectId: string, path: string) => FileKind | null;
  onPick: (file: RepoFile) => void;
  onChanges: (on: boolean) => void;
  onDependents: (on: boolean) => void;
  onRunning: (on: boolean) => void;
  onReview: () => void;
}

interface ToggleChipProps {
  on: boolean;
  disabled?: boolean;
  tip: string;
  icon?: ReactNode;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}

function ToggleChip({ on, disabled = false, tip, icon, onToggle, children }: ToggleChipProps) {
  const { triggerProps, tooltip } = useTooltip(tip);
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={disabled || undefined}
        className="map-toggle"
        {...triggerProps}
        onClick={() => {
          if (!disabled) onToggle(!on);
        }}
      >
        {icon}
        {children}
      </button>
      {tooltip}
    </>
  );
}

function ReviewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 6h16M4 12h10M4 18h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MapHeader(props: MapHeaderProps) {
  const { changes } = props;
  return (
    <header className="map-head">
      <h1 className="map-title">Map</h1>
      <RepoPicker projects={props.projects} selected={props.selected} onChange={props.onProjects} />
      <div className="map-views">
        <Segmented
          ariaLabel="Show the map as"
          options={MAP_VIEWS.map((id) => ({ id, label: VIEW_LABELS[id] }))}
          value={props.view}
          onChange={(id) => props.onView(id as MapViewId)}
        />
      </div>
      <MapSearch
        projects={props.chosen}
        inputRef={props.searchRef}
        kindOf={props.kindOf}
        onPick={props.onPick}
      />
      <span className="map-sp" />
      <div className="map-actions">
        <MapStatusPill maps={props.maps} build={props.build} />
        <ToggleChip
          on={changes.on}
          disabled={!changes.chat}
          tip={
            changes.chat
              ? `Light up the files “${changes.chat}” changed`
              : 'No chat has changed files in this project yet'
          }
          icon={<SparkleIcon />}
          onToggle={props.onChanges}
        >
          <span className="map-lbl">This chat’s changes</span>
          {changes.on && changes.count !== null && <span className="map-cnt">{changes.count}</span>}
        </ToggleChip>
        {changes.on && (
          <ToggleChip
            on={props.dependents}
            tip="Also light up files that import the changed ones"
            onToggle={props.onDependents}
          >
            <span className="map-lbl">Include dependents</span>
          </ToggleChip>
        )}
        <ToggleChip
          on={props.running.on}
          disabled={props.running.count === 0 && !props.running.on}
          tip={
            props.running.count > 0
              ? 'Mark the files chats are changing right now'
              : 'No chat is working in this project right now'
          }
          icon={<SpinnerIcon />}
          onToggle={props.onRunning}
        >
          <span className="map-lbl">Running chats</span>
          {props.running.count > 0 && <span className="map-cnt">{props.running.count}</span>}
        </ToggleChip>
        <button
          type="button"
          className="map-quiet"
          aria-expanded={props.reviewOpen}
          onClick={props.onReview}
        >
          <ReviewIcon />
          <span className="map-lbl">Review areas</span>
          {props.toCheck > 0 && (
            <span className="map-badge">
              <span className="sr-only">, </span>
              {props.toCheck}
              <span className="sr-only"> to check</span>
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
