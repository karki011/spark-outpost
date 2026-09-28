import type { SpendLeaf } from '@spark-outpost/contracts';
import { providerColor, providerName } from '../../chat/provider-name.ts';
import { usd } from '../analytics-model.ts';
import { Mark, roveMarks } from './Mark.tsx';
import { GROUP_HEADER, treemap } from './treemap-layout.ts';
import { useChartWidth } from './use-chart-width.ts';

interface TreeItem {
  group: string;
  subgroup: string;
  label: string;
  value: number;
  source: SpendLeaf;
}

function fit(text: string, width: number): string {
  const chars = Math.floor((width - 14) / 6.6);
  if (chars >= text.length) return text;
  return chars < 4 ? '' : `${text.slice(0, chars - 1)}…`;
}

export function SpendTreemap({ leaves, total }: { leaves: readonly SpendLeaf[]; total: number }) {
  const { ref, width } = useChartWidth<HTMLDivElement>(640, 300);
  const height = width < 520 ? 360 : 320;
  const items: TreeItem[] = leaves.map((leaf) => ({
    group: leaf.project,
    subgroup: leaf.provider,
    label: leaf.modelLabel,
    value: leaf.costUsd,
    source: leaf,
  }));
  const layout = treemap(items, width, height);
  const providers = [...new Set(leaves.map((leaf) => leaf.provider))];
  return (
    <div ref={ref} className="an-fill">
      <svg
        width={width}
        height={height}
        role="group"
        aria-label="Spend by project, provider and model"
        onKeyDown={roveMarks}
      >
        {layout.groups.map((group) => (
          <g key={group.label} aria-hidden="true">
            <rect
              className="an-tree-group"
              x={group.x + 1}
              y={group.y + 1}
              width={Math.max(0, group.w - 2)}
              height={Math.max(0, group.h - 2)}
              rx={8}
            />
            {group.w > 60 && (
              <text className="an-tree-head" x={group.x + 9} y={group.y + GROUP_HEADER - 7}>
                {fit(`${group.label} · ${usd(group.value)}`, group.w)}
              </text>
            )}
          </g>
        ))}
        {layout.leaves.map((placed, index) => {
          const { source } = placed.leaf;
          const share = total > 0 ? Math.round((source.costUsd / total) * 100) : 0;
          const label = `${source.project}, ${providerName(source.provider)} ${source.modelLabel}: ${usd(source.costUsd)} (${share}% of spend), ${source.runs} runs${source.estimatedUsd > 0 ? `, ${usd(source.estimatedUsd)} estimated` : ''}`;
          const showName = placed.w > 56 && placed.h > 36;
          const showCost = placed.w > 44 && placed.h > 20;
          return (
            <Mark
              key={`${source.project}-${source.provider}-${source.modelLabel}`}
              label={label}
              first={index === 0}
            >
              <rect
                className="an-hit"
                x={placed.x - 1}
                y={placed.y - 1}
                width={placed.w + 2}
                height={placed.h + 2}
                rx={6}
              />
              <rect
                className="an-tile"
                x={placed.x}
                y={placed.y}
                width={placed.w}
                height={placed.h}
                rx={5}
                style={{
                  fill: `color-mix(in srgb, ${providerColor(source.provider)} 16%, var(--panel))`,
                }}
              />
              <rect
                x={placed.x}
                y={placed.y}
                width={Math.min(4, placed.w)}
                height={placed.h}
                rx={2}
                style={{ fill: providerColor(source.provider) }}
              />
              {showName && (
                <text className="an-tile-name" x={placed.x + 10} y={placed.y + 18}>
                  {fit(source.modelLabel, placed.w)}
                </text>
              )}
              {showCost && (
                <text
                  className="an-tile-cost"
                  x={placed.x + 10}
                  y={placed.y + (showName ? 34 : 15)}
                >
                  {fit(usd(source.costUsd), placed.w)}
                </text>
              )}
            </Mark>
          );
        })}
      </svg>
      <ul className="an-legend">
        {providers.map((provider) => (
          <li key={provider}>
            <i className="an-swatch" style={{ background: providerColor(provider) }} />
            {providerName(provider)}
          </li>
        ))}
      </ul>
    </div>
  );
}
