import { useId, useState } from 'react';
import { FLOW_STAGES, type FlowPath } from '@spark-outpost/contracts';
import {
  categoryName,
  depthName,
  percent,
  plural,
  verdictName,
  VERDICT_ORDER,
} from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { HatchPattern } from './Patterns.tsx';
import { linkPath, OTHER, sankeyLayout, type SankeyNode } from './sankey-layout.ts';
import { useChartWidth } from './use-chart-width.ts';
import { verdictColor } from './VerdictShape.tsx';

const NODE = 10;
const TOP = 26;
const MIN_WIDTH = 700;
const STAGE_NAMES = ['Request', 'Depth', 'Crew', 'Model', 'Outcome'];

function nodeName(stage: number, key: string): string {
  if (key === OTHER) return 'Other';
  if (stage === 0) return categoryName(key);
  if (stage === 1) return depthName(key);
  if (stage === 4) return verdictName(key);
  return key;
}

function fit(text: string, room: number): string {
  const chars = Math.floor(room / 6.4);
  return text.length <= chars ? text : `${text.slice(0, Math.max(3, chars - 1))}…`;
}

export function RoutingFlow({ paths }: { paths: readonly FlowPath[] }) {
  const hatch = useId();
  const { ref, width: measured } = useChartWidth<HTMLDivElement>(MIN_WIDTH, MIN_WIDTH);
  const width = Math.max(MIN_WIDTH, measured);
  const height = 380;
  const [active, setActive] = useState<SankeyNode | null>(null);
  const providerOf = new Map(paths.map((path) => [path.model, path.provider]));
  const total = paths.reduce((sum, path) => sum + path.turns, 0);
  const layout = sankeyLayout(
    paths.map((path) => ({ stages: FLOW_STAGES.map((stage) => path[stage]), value: path.turns })),
    {
      width,
      height: height - TOP,
      nodeWidth: NODE,
      gap: 10,
      maxPerStage: 7,
      order: (stage) => (stage === 4 ? VERDICT_ORDER : null),
    },
  );
  const step = (width - NODE) / (FLOW_STAGES.length - 1);
  const activePaths = new Set(active?.paths ?? []);
  const fill = (node: SankeyNode) => {
    if (node.stage === 3) return `var(--c-${providerOf.get(node.label) ?? 'none'}, var(--muted))`;
    if (node.stage === 4 && node.label === 'bad') return `url(#${hatch})`;
    if (node.stage === 4) return verdictColor(node.label);
    return 'var(--muted)';
  };
  return (
    <div ref={ref} className="an-scroll">
      <svg
        width={width}
        height={height}
        role="group"
        aria-label="Routing flow from request to outcome"
        onKeyDown={roveMarks}
      >
        <defs>
          <HatchPattern id={hatch} color="var(--danger)" />
        </defs>
        <g aria-hidden="true" className="an-axis">
          {STAGE_NAMES.map((name, stage) => (
            <text
              key={name}
              className="an-stage"
              x={stage * step + (stage === STAGE_NAMES.length - 1 ? NODE : 0)}
              y={14}
              textAnchor={stage === STAGE_NAMES.length - 1 ? 'end' : 'start'}
            >
              {name}
            </text>
          ))}
        </g>
        <g transform={`translate(0 ${TOP})`}>
          <g aria-hidden="true">
            {layout.links.map((link) => {
              const lit = active !== null && link.paths.some((index) => activePaths.has(index));
              return (
                <path
                  key={link.id}
                  className={lit ? 'an-link on' : active ? 'an-link dim' : 'an-link'}
                  d={linkPath(link, NODE)}
                />
              );
            })}
          </g>
          {layout.nodes.map((node, index) => {
            const name = nodeName(node.stage, node.label);
            const last = node.stage === FLOW_STAGES.length - 1;
            const room = step - NODE - 14;
            return (
              <Mark
                key={node.id}
                first={index === 0}
                label={`${STAGE_NAMES[node.stage]}: ${name}, ${plural(node.value, 'turn')} (${percent(node.value, total)})`}
                onActive={(on) => setActive(on ? node : null)}
              >
                <rect
                  className="an-hit"
                  x={node.x - 3}
                  y={node.y - 3}
                  width={NODE + 6}
                  height={node.h + 6}
                  rx={4}
                />
                <rect
                  className="an-node"
                  x={node.x}
                  y={node.y}
                  width={NODE}
                  height={node.h}
                  rx={3}
                  style={{
                    fill: fill(node),
                    stroke: node.stage === 4 && node.label === 'bad' ? 'var(--danger)' : undefined,
                  }}
                />
                {node.h >= 9 && (
                  <text
                    className="an-node-label"
                    x={last ? node.x - 6 : node.x + NODE + 6}
                    y={node.y + node.h / 2 + 4}
                    textAnchor={last ? 'end' : 'start'}
                  >
                    {fit(`${name} ${node.value}`, last ? 120 : room)}
                  </text>
                )}
              </Mark>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
