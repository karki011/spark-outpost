import { createContext, memo, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { MAP_CATEGORIES, type MapArea, type MapCategory } from '@spark-outpost/contracts';
import { ChevronIcon, FolderIcon } from '../../ui/icons.tsx';
import { FILE_KINDS, FILE_KIND_LABELS, type FileKind } from '../file-kind.ts';
import { KindDot } from '../JevLabel.tsx';
import { CATEGORY_LABELS, confidenceText, labelSource } from '../map-model.ts';
import type { TreeItem } from './tree-model.ts';

export class ActiveStore {
  private listeners = new Set<() => void>();
  constructor(public active: string | null = null) {}

  set(id: string | null): void {
    if (id === this.active) return;
    this.active = id;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export interface TreeActions {
  active: ActiveStore;
  maxImportance: number;
  setActive: (id: string) => void;
}

export const TreeContext = createContext<TreeActions | null>(null);

function useTree(): TreeActions {
  return useContext(TreeContext)!;
}

export type FlowNode = Node<{ item: TreeItem }>;

const NUMBER = new Intl.NumberFormat('en-US');
const COMPACT_BELOW = 0.45;
const plural = (count: number, word: string) =>
  `${NUMBER.format(count)} ${word}${count === 1 ? '' : 's'}`;
const compactZoom = (state: { transform: [number, number, number] }) =>
  state.transform[2] < COMPACT_BELOW;

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="map-tn-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="map-tn-handle"
      />
    </>
  );
}

export function areaTierTip(area: MapArea): string {
  const confidence = confidenceText(area);
  const by = `${CATEGORY_LABELS[area.category]}, labelled by ${labelSource(area)}`;
  return confidence ? `${by} · confidence ${confidence}` : by;
}

export function groupTierTip(areas: readonly MapArea[], category: MapCategory): string {
  const counts = MAP_CATEGORIES.map(
    (c) => [c, areas.filter((area) => area.category === c).length] as const,
  ).filter(([, n]) => n > 0);
  const sources = ['You', 'Jev', 'Rules']
    .map((who) => [who, areas.filter((area) => labelSource(area) === who).length] as const)
    .filter(([, n]) => n > 0)
    .map(([who, n]) => `${who} ${n}`);
  const mix = counts.map(([c, n]) => `${n} ${CATEGORY_LABELS[c]}`).join(', ');
  return `Mostly ${CATEGORY_LABELS[category]} (${mix}) · labelled by ${sources.join(', ')}`;
}

function Tier({ category, tip }: { category: MapCategory; tip: string }) {
  return (
    <span className="map-tn-tier" data-tip={tip}>
      <i className={`map-tier ${category}`} aria-hidden="true" />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function KindMix({ counts }: { counts: Record<FileKind, number> }) {
  const kinds = FILE_KINDS.filter((kind) => counts[kind] > 0);
  const total = kinds.reduce((sum, kind) => sum + counts[kind], 0) || 1;
  const ends = kinds.map((_, index) =>
    kinds.slice(0, index + 1).reduce((sum, kind) => sum + counts[kind], 0),
  );
  const percent = (value: number) => `${((value / total) * 100).toFixed(1)}%`;
  const stops = kinds.map(
    (kind, index) =>
      `var(--map-k-${kind}) ${percent(ends[index]! - counts[kind])} ${percent(ends[index]!)}`,
  );
  return (
    <span
      className="map-tn-kinds"
      aria-hidden="true"
      style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }}
    />
  );
}

function kindText(counts: Record<FileKind, number>): string {
  return FILE_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => `${counts[kind]} ${FILE_KIND_LABELS[kind]}`)
    .join(', ');
}

interface ShellProps {
  item: TreeItem;
  label: string;
  expanded?: boolean;
  className: string;
  children: ReactNode;
}

function Shell({ item, label, expanded, className, children }: ShellProps) {
  const tree = useTree();
  const active = useSyncExternalStore(tree.active.subscribe, () => tree.active.active === item.id);
  return (
    <div
      className={className}
      data-tree-node={item.id}
      data-active={active || undefined}
      role="button"
      tabIndex={active ? 0 : -1}
      aria-label={label}
      aria-expanded={expanded}
      onFocus={() => tree.setActive(item.id)}
    >
      {children}
    </div>
  );
}

function Changed({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="map-tn-changed">{count} changed</span>;
}

function Importance({ value }: { value: number }) {
  const tree = useTree();
  const share = Math.round(Math.max(0.04, Math.min(1, value / (tree.maxImportance || 1))) * 100);
  return (
    <span
      className="map-tn-imp"
      aria-hidden="true"
      style={{
        background: `linear-gradient(90deg, var(--map-gold) ${share}%, var(--raise) ${share}%)`,
      }}
    />
  );
}

interface UnitFacts {
  name: string;
  path: string;
  files: number;
  category: MapCategory;
  tip: string;
  importance: number;
  kinds: Record<FileKind, number>;
  changed: number;
  what: string;
}

function unitFacts(item: TreeItem): UnitFacts | null {
  if (item.kind === 'group') {
    return {
      name: item.group.name,
      path: item.group.pooled ? `${item.areas.length} small areas` : item.group.path || '(root)',
      files: item.files,
      category: item.group.category,
      tip: groupTierTip(item.areas, item.group.category),
      importance: item.group.importance,
      kinds: item.group.kindCounts,
      changed: item.changed,
      what: `group of ${plural(item.areas.length, 'area')}`,
    };
  }
  if (item.kind === 'area') {
    return {
      name: item.area.name,
      path: item.area.root || '(root)',
      files: item.area.fileCount,
      category: item.area.category,
      tip: areaTierTip(item.area),
      importance: item.area.importance,
      kinds: item.area.kindCounts,
      changed: item.changed,
      what: 'area',
    };
  }
  return null;
}

function unitLabel(facts: UnitFacts, open: boolean): string {
  const changed = facts.changed > 0 ? `, ${facts.changed} changed in this chat` : '';
  const action = open ? 'Press Escape to close' : 'Press Enter to open';
  return `${facts.name}, ${facts.what}, ${plural(facts.files, 'file')}, ${facts.tip}, ${kindText(facts.kinds)}${changed}. ${action}.`;
}

function UnitNode({ data }: NodeProps<FlowNode>) {
  const compact = useStore(compactZoom);
  const { item } = data;
  const facts = unitFacts(item)!;
  if (item.container) {
    return (
      <div className={`map-tn-frame ${item.kind}`} data-changed={facts.changed > 0 || undefined}>
        <Shell item={item} label={unitLabel(facts, true)} expanded className="map-tn-head">
          <span className="map-tn-chev open" aria-hidden="true">
            <ChevronIcon />
          </span>
          <b>{facts.name}</b>
          <Tier category={facts.category} tip={facts.tip} />
          <Changed count={facts.changed} />
          <span className="map-tn-count">{plural(facts.files, 'file')}</span>
        </Shell>
        <Handles />
      </div>
    );
  }
  if (compact) {
    return (
      <Shell
        item={item}
        label={unitLabel(facts, false)}
        expanded={false}
        className={`map-tn map-tn-unit compact ${item.kind} ${facts.category}`}
      >
        <b className="map-tn-name">{facts.name}</b>
        <span className="map-tn-count">{NUMBER.format(facts.files)}</span>
        {facts.changed > 0 && <span className="map-tn-dot" aria-hidden="true" />}
        <Handles />
      </Shell>
    );
  }
  return (
    <Shell
      item={item}
      label={unitLabel(facts, false)}
      expanded={false}
      className={`map-tn map-tn-unit ${item.kind} ${facts.category}`}
    >
      <span className="map-tn-row">
        <b className="map-tn-name">{facts.name}</b>
        <span className="map-tn-count">{NUMBER.format(facts.files)}</span>
      </span>
      <span className="map-tn-path">{facts.path}</span>
      <span className="map-tn-row">
        <Tier category={facts.category} tip={facts.tip} />
        {item.kind === 'group' && <span className="map-tn-stack">{facts.what}</span>}
        <Changed count={facts.changed} />
      </span>
      <span className="map-tn-bars">
        <Importance value={facts.importance} />
        <KindMix counts={facts.kinds} />
      </span>
      <Handles />
    </Shell>
  );
}

function FolderNode({ data }: NodeProps<FlowNode>) {
  const { item } = data;
  if (item.kind !== 'folder') return null;
  const label = `${item.path} folder, ${plural(item.files, 'file')}${item.changed ? `, ${item.changed} changed in this chat` : ''}. ${item.container ? 'Press Escape to close' : 'Press Enter to open'}.`;
  const body = (
    <>
      <span className={`map-tn-chev${item.container ? ' open' : ''}`} aria-hidden="true">
        <ChevronIcon />
      </span>
      <FolderIcon />
      <b className="map-mono">{item.path}/</b>
      <Changed count={item.changed} />
      <span className="map-tn-count">{item.files}</span>
    </>
  );
  if (item.container) {
    return (
      <div className="map-tn-frame folder">
        <Shell item={item} label={label} expanded className="map-tn-head">
          {body}
        </Shell>
        <Handles />
      </div>
    );
  }
  return (
    <Shell item={item} label={label} expanded={false} className="map-tn map-tn-folder">
      {body}
      <Handles />
    </Shell>
  );
}

function FileNode({ data }: NodeProps<FlowNode>) {
  const { item } = data;
  if (item.kind !== 'file') return null;
  const label = `${item.path}, ${FILE_KIND_LABELS[item.fileKind]}, ${plural(item.fanIn, 'file')} depend on this${item.changed ? ', changed in this chat' : ''}. Enter shows details, F focuses it.`;
  return (
    <Shell item={item} label={label} className="map-tn map-tn-file">
      <KindDot kind={item.fileKind} />
      <span className="map-tn-fname map-mono">{item.name}</span>
      {item.changed && <span className="map-tn-dot" aria-hidden="true" />}
      <span className="map-tn-count">{item.fanIn}</span>
      <Handles />
    </Shell>
  );
}

function MoreNode({ data }: NodeProps<FlowNode>) {
  const { item } = data;
  if (item.kind !== 'more') return null;
  const text = `${plural(item.hidden, `more ${item.unit}`)}`;
  return (
    <Shell item={item} label={`Show ${text}`} className="map-tn map-tn-more">
      +{text}
      <Handles />
    </Shell>
  );
}

function LoadingNode() {
  return (
    <div className="map-tn map-tn-loading" role="img" aria-label="Files are loading">
      {[78, 56, 68].map((width) => (
        <span key={width} className="map-sk" style={{ width: `${width}%` }} />
      ))}
      <Handles />
    </div>
  );
}

function ProjectNode({ data }: NodeProps<FlowNode>) {
  const { item } = data;
  if (item.kind !== 'project') return null;
  return (
    <div className="map-tn-frame project">
      <div className="map-tn-head map-tn-project">
        <b>{item.name}</b>
      </div>
      <Handles />
    </div>
  );
}

const Unit = memo(UnitNode);

export const NODE_TYPES = {
  group: Unit,
  area: Unit,
  folder: memo(FolderNode),
  file: memo(FileNode),
  more: memo(MoreNode),
  loading: memo(LoadingNode),
  project: memo(ProjectNode),
};
