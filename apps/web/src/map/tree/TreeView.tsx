import '@xyflow/react/dist/base.css';
import './tree.css';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { Segmented } from '../../ui/Segmented.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { ZoomButton } from '../ZoomButton.tsx';
import {
  ActiveStore,
  NODE_TYPES,
  TreeContext,
  type FlowNode,
  type TreeActions,
} from './TreeNodes.tsx';
import { HEADER, type LayoutResult, type Placed } from './tree-layout.ts';
import {
  AREA_LIMIT,
  buildTree,
  FILE_LIMIT,
  revealIds,
  visibleEdges,
  type EdgeLevel,
  type TreeItem,
  type TreeSource,
} from './tree-model.ts';
import { ARROWS, nearest, type NavBox } from './tree-nav.ts';
import { useTreeLayout } from './use-tree-layout.ts';

export interface TreeReveal {
  area: string;
  file?: number;
  nonce: number;
}

interface TreeViewProps {
  source: TreeSource;
  label: string;
  reveal: TreeReveal | null;
  require: (keys: readonly string[]) => void;
  onFile: (file: number) => void;
  onFocusFile: (file: number) => void;
  announce: (text: string) => void;
}

const LEVELS = [
  { id: 'strong', label: 'Strong' },
  { id: 'more', label: 'More' },
  { id: 'all', label: 'All' },
];
const MORE_STEP = 48;
const FIRST_ZOOM = 0.5;
const FOCUS_TRIES = 12;
const NOT_NAVIGABLE = new Set(['project', 'loading']);

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function absolute(items: readonly TreeItem[], result: LayoutResult): Map<string, NavBox> {
  const boxes = new Map<string, NavBox>();
  for (const item of items) {
    const placed = result[item.id];
    if (!placed) continue;
    const parent = item.parent ? boxes.get(item.parent) : undefined;
    boxes.set(item.id, {
      id: item.id,
      x: placed.x + (parent?.x ?? 0),
      y: placed.y + (parent?.y ?? 0),
      width: placed.width,
      height: placed.height,
    });
  }
  return boxes;
}

function samePlace(node: FlowNode, placed: Placed): boolean {
  return (
    node.position.x === placed.x &&
    node.position.y === placed.y &&
    node.width === placed.width &&
    node.height === placed.height
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameItem(a: TreeItem, b: TreeItem): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameValue(left[key], right[key]))
  );
}

function nameOf(item: TreeItem): string {
  if (item.kind === 'group') return item.group.name;
  if (item.kind === 'area') return item.area.name;
  if (item.kind === 'folder') return `${item.path}/`;
  return '';
}

function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function TreeCanvas({
  source,
  label,
  reveal,
  require,
  onFile,
  onFocusFile,
  announce,
}: TreeViewProps) {
  const flow = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<ReadonlyMap<string, number>>(new Map());
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [level, setLevel] = useState<EdgeLevel>('strong');
  const [tipText, setTipText] = useState('');
  const tip = useTooltip(tipText);
  const pendingFocus = useRef<string | null>(null);
  const [handled, setHandled] = useState(0);
  const [revealTarget, setRevealTarget] = useState<string | null>(null);
  const centred = useRef(0);
  const fitTo = useRef<string | null>(null);
  const fitted = useRef(false);
  const fitMin = useRef(FIRST_ZOOM);

  const graph = useMemo(
    () => buildTree(source, { expanded, limits, pinned }),
    [source, expanded, limits, pinned],
  );
  const layout = useTreeLayout(graph.layout);
  const boxes = useMemo(
    () => (layout ? absolute(graph.items, layout.result) : new Map<string, NavBox>()),
    [graph.items, layout],
  );
  const byId = useMemo(() => new Map(graph.items.map((item) => [item.id, item])), [graph.items]);
  const firstId = graph.items.find((item) => !NOT_NAVIGABLE.has(item.kind))?.id ?? null;
  const current = active && byId.has(active) ? active : firstId;

  const duration = reducedMotion() ? 0 : 280;

  const [nodeCache] = useState(() => new Map<string, FlowNode>());
  const nodes = useMemo<FlowNode[]>(() => {
    if (!layout) return [];
    return graph.items.flatMap((item) => {
      const placed = layout.result[item.id];
      if (!placed || (item.parent && !layout.result[item.parent])) return [];
      const cached = nodeCache.get(item.id);
      if (cached && samePlace(cached, placed) && sameItem(cached.data.item, item)) return [cached];
      const node: FlowNode = {
        id: item.id,
        type: item.kind,
        position: { x: placed.x, y: placed.y },
        ...(item.parent ? { parentId: item.parent } : {}),
        data: { item },
        width: placed.width,
        height: placed.height,
        style: { width: placed.width, height: placed.height },
        draggable: false,
        selectable: false,
        focusable: false,
      };
      nodeCache.set(item.id, node);
      return [node];
    });
  }, [graph.items, layout, nodeCache]);

  const edges = useMemo<Edge[]>(() => {
    const shown = visibleEdges(graph, level).filter(
      (edge) => layout?.result[edge.source] && layout.result[edge.target],
    );
    const max = Math.max(1, ...shown.filter((edge) => !edge.bridge).map((edge) => edge.weight));
    const title = (id: string) => {
      const item = byId.get(id);
      if (item?.kind === 'file') return item.name;
      return item ? nameOf(item) : id;
    };
    return shown.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ariaLabel: `${title(edge.source)} ${edge.bridge ? 'calls' : 'imports'} ${title(edge.target)}`,
      className: edge.bridge ? 'map-te bridge' : 'map-te',
      style: { strokeWidth: edge.bridge ? 2 : 1 + 3 * Math.sqrt(edge.weight / max) },
      focusable: false,
      selectable: false,
    }));
  }, [graph, level, layout, byId]);

  const centreOn = useCallback(
    (id: string, zoom?: number) => {
      const box = boxes.get(id);
      if (!box) return;
      const height = byId.get(id)?.container ? HEADER : box.height;
      flow.setCenter(box.x + box.width / 2, box.y + height / 2, {
        zoom: zoom ?? flow.getZoom(),
        duration,
      });
    },
    [boxes, byId, flow, duration],
  );

  const ensureVisible = useCallback(
    (id: string) => {
      const box = boxes.get(id);
      const wrap = wrapRef.current;
      if (!box || !wrap) return;
      const { x, y, zoom } = flow.getViewport();
      const left = box.x * zoom + x;
      const top = box.y * zoom + y;
      const inside =
        left >= 0 &&
        top >= 0 &&
        left + Math.min(box.width, 300) * zoom <= wrap.clientWidth &&
        top + Math.min(box.height, HEADER) * zoom <= wrap.clientHeight;
      if (!inside) centreOn(id);
    },
    [boxes, flow, centreOn],
  );

  const moveTo = useCallback(
    (id: string) => {
      setActive(id);
      pendingFocus.current = id;
      ensureVisible(id);
    },
    [ensureVisible],
  );

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const element = wrapRef.current?.querySelector<HTMLElement>(
        `[data-tree-node="${CSS.escape(id)}"]`,
      );
      if (element) {
        element.focus({ preventScroll: true });
        pendingFocus.current = null;
        return;
      }
      tries += 1;
      if (tries < FOCUS_TRIES) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [active, nodes]);

  useEffect(() => {
    if (!layout || nodes.length === 0) return;
    if (!fitted.current) {
      fitted.current = true;
      void flow.fitView({ padding: 0.12, duration: 0, maxZoom: 1, minZoom: fitMin.current });
    }
    if (!layout.fresh) return;
    const target = revealTarget;
    if (target && centred.current !== handled && layout.result[target]) {
      centred.current = handled;
      centreOn(target, Math.max(flow.getZoom(), 0.9));
      moveTo(target);
      return;
    }
    const opened = fitTo.current;
    if (opened && layout.result[opened] && !layout.result[`l:${opened}`]) {
      fitTo.current = null;
      const box = boxes.get(opened);
      if (box) void flow.fitBounds(box, { padding: 0.12, duration });
    }
  }, [layout, nodes.length, flow, centreOn, moveTo, duration, revealTarget, handled, boxes]);

  if (reveal && reveal.nonce !== handled) {
    setHandled(reveal.nonce);
    const { expand, target } = revealIds(source.scene, source.groups, reveal.area, reveal.file);
    const file = reveal.file !== undefined;
    const opened = file ? expand : expand.filter((id) => id !== reveal.area);
    setExpanded((previous) => new Set([...previous, ...opened]));
    setPinned((previous) => new Set([...previous, reveal.area, ...(file ? [target] : [])]));
    setRevealTarget(target);
  }
  useEffect(() => {
    if (reveal?.file !== undefined) require([reveal.area]);
  }, [reveal, require]);

  const activate = useCallback(
    (item: TreeItem) => {
      if (item.kind === 'file') {
        onFile(item.file);
        return;
      }
      if (item.kind === 'more') {
        const base = item.unit === 'area' ? AREA_LIMIT : FILE_LIMIT;
        setLimits((previous) =>
          new Map(previous).set(item.owner, (previous.get(item.owner) ?? base) + MORE_STEP),
        );
        return;
      }
      if (item.kind !== 'group' && item.kind !== 'area' && item.kind !== 'folder') return;
      const opening = !expanded.has(item.id);
      if (opening && item.kind === 'area') require([item.id]);
      if (opening) fitTo.current = item.id;
      pendingFocus.current = item.id;
      setExpanded((previous) => toggled(previous, item.id));
      announce(`${nameOf(item)} ${opening ? 'opened' : 'closed'}.`);
    },
    [expanded, onFile, require, announce],
  );

  const zoomKey = (key: string): boolean => {
    if (key === '+' || key === '=') void flow.zoomIn({ duration });
    else if (key === '-' || key === '−') void flow.zoomOut({ duration });
    else if (key === '0') void flow.fitView({ padding: 0.12, duration });
    else return false;
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest('[data-tree-node]')) return;
    if (zoomKey(event.key)) {
      event.preventDefault();
      return;
    }
    const item = current ? byId.get(current) : undefined;
    if (!current || !item) return;
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      const navigable = [...boxes.values()].filter(
        (box) => !NOT_NAVIGABLE.has(byId.get(box.id)?.kind ?? 'loading'),
      );
      const header = navigable.map((box) =>
        byId.get(box.id)?.container ? { ...box, height: HEADER } : box,
      );
      const next = nearest(header, current, direction);
      if (next) moveTo(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(item);
      return;
    }
    if ((event.key === 'f' || event.key === 'F') && item.kind === 'file') {
      event.preventDefault();
      onFocusFile(item.file);
      return;
    }
    if (event.key === 'Escape') {
      const closing = item.container ? item : item.parent ? byId.get(item.parent) : undefined;
      if (!closing || closing.kind === 'project') return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded((previous) => {
        const next = new Set(previous);
        next.delete(closing.id);
        return next;
      });
      announce(`${nameOf(closing)} closed.`);
      moveTo(closing.id);
    }
  };

  const [activeStore] = useState(() => new ActiveStore());
  useEffect(() => activeStore.set(current), [activeStore, current]);
  const maxImportance = Math.max(0, ...source.scene.areas.map((entry) => entry.area.importance));
  const actions = useMemo<TreeActions>(
    () => ({ active: activeStore, maxImportance, setActive }),
    [activeStore, maxImportance],
  );

  return (
    <div
      className="map-tree"
      ref={wrapRef}
      role="application"
      aria-roledescription="tree map"
      aria-label={label}
      aria-describedby="map-tree-help"
      aria-busy={!layout || undefined}
      onKeyDown={onKeyDown}
      onPointerOver={(event) => {
        const anchor = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]');
        if (!anchor) return;
        setTipText(anchor.dataset.tip ?? '');
        tip.show(anchor);
      }}
      onPointerOut={(event) => {
        if ((event.target as HTMLElement).closest('[data-tip]')) tip.triggerProps.onPointerLeave();
      }}
    >
      {tip.tooltip}
      <p id="map-tree-help" className="sr-only">
        Arrow keys move between boxes. Enter opens a group, area or folder, or shows a file. Escape
        closes. F focuses a file. Plus and minus zoom, 0 fits the tree.
      </p>
      <TreeContext value={actions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onlyRenderVisibleElements
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          minZoom={0.05}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(event, node) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-node]');
            if (target?.dataset.treeNode !== node.id) return;
            setActive(node.id);
            activate(node.data.item);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            ariaLabel="Overview of the tree"
            nodeClassName={(node) => `map-mini ${(node as FlowNode).data.item.kind}`}
            className="map-tree-mini"
          />
        </ReactFlow>
      </TreeContext>
      <div className="map-tree-bar map-glass" data-map-overlay>
        <span className="map-tree-bar-lbl" id="map-tree-links">
          Links
        </span>
        <Segmented
          ariaLabel="Links to show"
          options={LEVELS}
          value={level}
          onChange={(id) => setLevel(id as EdgeLevel)}
        />
        {expanded.size > 0 && (
          <button
            type="button"
            className="map-quiet"
            onClick={() => {
              setExpanded(new Set());
              setPinned(new Set());
              fitted.current = false;
              fitMin.current = 0;
            }}
          >
            Close all
          </button>
        )}
      </div>
      <div className="map-zoom map-glass" role="group" aria-label="Zoom">
        <ZoomButton
          label="Zoom in"
          keys={['+']}
          path="M12 5v14M5 12h14"
          onClick={() => void flow.zoomIn({ duration })}
        />
        <ZoomButton
          label="Zoom out"
          keys={['−']}
          path="M5 12h14"
          onClick={() => void flow.zoomOut({ duration })}
        />
        <ZoomButton
          label="Fit the whole tree"
          keys={['0']}
          path="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
          onClick={() => void flow.fitView({ padding: 0.12, duration })}
        />
      </div>
    </div>
  );
}

export default function TreeView(props: TreeViewProps) {
  return (
    <ReactFlowProvider>
      <TreeCanvas {...props} />
    </ReactFlowProvider>
  );
}
