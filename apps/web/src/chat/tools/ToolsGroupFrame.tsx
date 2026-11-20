import { createContext, useContext, useId, type ReactNode } from 'react';
import { useSwitchWords } from '../../brand/switch-words.ts';
import { SparkleIcon, StrokeIcon } from '../../ui/icons.tsx';

export interface RailGroups {
  isOpen(key: string): boolean;
  toggle(key: string): void;
}

const RailGroupsContext = createContext<RailGroups | null>(null);

export const RailGroupsProvider = RailGroupsContext.Provider;

export function useRailGroups(): RailGroups | null {
  return useContext(RailGroupsContext);
}

const ICONS = {
  project: <SparkleIcon />,
  mcp: <StrokeIcon path="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  plugins: <StrokeIcon path="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4z" />,
  connectors: (
    <StrokeIcon path="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
};

export type ToolsGroupKind = keyof typeof ICONS;

interface ToolsGroupFrameProps {
  groupKey: string;
  kind: ToolsGroupKind;
  title: string;
  scope: string;
  summary: string | null;
  children: ReactNode;
}

export function ToolsGroupFrame({
  groupKey,
  kind,
  title,
  scope,
  summary,
  children,
}: ToolsGroupFrameProps) {
  const rail = useRailGroups();
  const bodyId = useId();
  if (!rail) {
    return (
      <div className="tools-group">
        <h4 className="tools-sub">
          {title} <span>{scope}</span>
        </h4>
        {children}
      </div>
    );
  }
  const open = rail.isOpen(groupKey);
  return (
    <div className="tools-group crail-group">
      <button
        type="button"
        className="crail-row crail-group-row"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => rail.toggle(groupKey)}
      >
        <span className="crail-ico" aria-hidden="true">
          {ICONS[kind]}
        </span>
        <span className="crail-main">
          {title}
          <span className="sr-only">, {scope}</span>
        </span>
        {summary && <span className="crail-detail">{summary}</span>}
        <span className="crail-chevron" data-open={open || undefined} aria-hidden="true">
          ›
        </span>
      </button>
      <div id={bodyId} className="crail-group-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

interface ToolTextProps {
  name: ReactNode;
  note: string;
  noteId?: string;
  full?: string;
  status?: boolean;
}

export function ToolText({ name, note, noteId, full, status = false }: ToolTextProps) {
  return (
    <span className="mcppop-text">
      <code>{name}</code>
      <small id={noteId} title={full ?? note} className={status ? 'tools-status' : undefined}>
        {note}
      </small>
    </span>
  );
}

export function RailOffWord({ checked }: { checked: boolean }) {
  const rail = useRailGroups();
  const words = useSwitchWords();
  if (!rail || words || checked) return null;
  return (
    <span className="tools-state" aria-hidden="true">
      Off
    </span>
  );
}
