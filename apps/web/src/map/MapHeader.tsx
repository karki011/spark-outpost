import type { RefObject } from 'react';
import type { Project, ProjectMap } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import type { RepoFile } from '../chat/project/use-file-search.ts';
import { MapStatusLine } from './BuildStatus.tsx';
import type { FileKind } from './file-kind.ts';
import { MapSearch } from './MapSearch.tsx';
import { RepoPicker } from './RepoPicker.tsx';

interface MapHeaderProps {
  projects: readonly Project[];
  selected: readonly string[];
  chosen: readonly Project[];
  maps: readonly ProjectMap[];
  searchRef: RefObject<HTMLInputElement | null>;
  changes: { on: boolean; count: number | null; chat: string | null };
  dependents: boolean;
  reviewOpen: boolean;
  onProjects: (ids: string[]) => void;
  kindOf: (projectId: string, path: string) => FileKind | null;
  onPick: (file: RepoFile) => void;
  onChanges: (on: boolean) => void;
  onDependents: (on: boolean) => void;
  onReview: () => void;
}

export function MapHeader(props: MapHeaderProps) {
  const { changes } = props;
  const changesLabel = changes.chat
    ? `Show changes from this chat (${changes.chat})`
    : 'Show changes from this chat';
  return (
    <header className="map-head">
      <h1 className="map-title">Map</h1>
      <RepoPicker projects={props.projects} selected={props.selected} onChange={props.onProjects} />
      <MapSearch
        projects={props.chosen}
        inputRef={props.searchRef}
        kindOf={props.kindOf}
        onPick={props.onPick}
      />
      <span className="map-sp" />
      <MapStatusLine maps={props.maps} />
      <span
        className="map-switch"
        title={changes.chat ? undefined : 'No chat has changed files here yet'}
      >
        <BlobToggle
          label={changesLabel}
          kind="spark"
          size="sm"
          checked={changes.on}
          disabled={!changes.chat}
          onChange={props.onChanges}
        />
        <span
          className="map-lbl"
          aria-hidden="true"
          onClick={() => changes.chat && props.onChanges(!changes.on)}
        >
          Show changes from this chat
        </span>
        {changes.on && changes.count !== null && <span className="map-cnt">{changes.count}</span>}
      </span>
      {changes.on && (
        <span className="map-switch">
          <BlobToggle
            label="Include files that depend on them"
            size="sm"
            checked={props.dependents}
            onChange={props.onDependents}
          />
          <span
            className="map-lbl"
            aria-hidden="true"
            onClick={() => props.onDependents(!props.dependents)}
          >
            Include files that depend on them
          </span>
        </span>
      )}
      <button
        type="button"
        className="map-btn"
        aria-expanded={props.reviewOpen}
        aria-label="Review areas"
        onClick={props.onReview}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className="map-lbl">Review areas</span>
      </button>
    </header>
  );
}
