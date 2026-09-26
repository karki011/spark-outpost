export interface BarGroup {
  label: string;
  values: { series: string; value: number; display: string }[];
}

export interface BarChartSpec {
  title: string;
  unit: (value: number) => string;
  series: readonly string[];
  groups: readonly BarGroup[];
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 8, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

const WIDTH = 640;
const LEFT = 44;
const RIGHT = 12;
const TOP = 12;
const PLOT_HEIGHT = 200;
const AXIS = 40;
const BAR = 18;
const GAP = 2;

function bars(spec: BarChartSpec, max: number, groupWidth: number): string {
  const scale = (value: number) => (value / max) * PLOT_HEIGHT;
  const baseline = TOP + PLOT_HEIGHT;
  return spec.groups
    .map((group, groupIndex) => {
      const clusterWidth = spec.series.length * BAR + (spec.series.length - 1) * GAP;
      const start = LEFT + groupIndex * groupWidth + (groupWidth - clusterWidth) / 2;
      const marks = spec.series.map((series, seriesIndex) => {
        const entry = group.values.find((value) => value.series === series);
        if (!entry) return '';
        const height = Math.max(scale(entry.value), entry.value > 0 ? 2 : 0);
        const x = start + seriesIndex * (BAR + GAP);
        const y = baseline - height;
        const radius = Math.min(4, height / 2);
        const path = `M${x},${baseline}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + BAR - radius}Q${x + BAR},${y} ${x + BAR},${y + radius}V${baseline}Z`;
        const tip = `${group.label} · ${series}: ${entry.display}`;
        return `<g class="mark"><path class="s${seriesIndex + 1}" d="${path}"><title>${escapeHtml(tip)}</title></path><rect class="hit" x="${x - 1}" y="${TOP}" width="${BAR + 2}" height="${PLOT_HEIGHT}"><title>${escapeHtml(tip)}</title></rect></g>`;
      });
      const labelX = LEFT + groupIndex * groupWidth + groupWidth / 2;
      return `${marks.join('')}<text class="tick" x="${labelX}" y="${baseline + 18}" text-anchor="middle">${escapeHtml(group.label)}</text>`;
    })
    .join('');
}

function gridlines(spec: BarChartSpec, max: number): string {
  const lines: string[] = [];
  for (let step = 0; step <= 4; step++) {
    const value = (max / 4) * step;
    const y = TOP + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;
    const kind = step === 0 ? 'baseline' : 'grid';
    lines.push(
      `<line class="${kind}" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${y}" y2="${y}"/><text class="tick" x="${LEFT - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(spec.unit(value))}</text>`,
    );
  }
  return lines.join('');
}

export function barChart(spec: BarChartSpec): string {
  const peak = Math.max(0, ...spec.groups.flatMap((group) => group.values.map((v) => v.value)));
  const max = niceMax(peak);
  const groupWidth = (WIDTH - LEFT - RIGHT) / Math.max(1, spec.groups.length);
  const height = TOP + PLOT_HEIGHT + AXIS;
  const legend = spec.series
    .map(
      (series, index) =>
        `<span class="key"><span class="swatch s${index + 1}"></span>${escapeHtml(series)}</span>`,
    )
    .join('');
  return `<figure class="chart">
<figcaption>${escapeHtml(spec.title)}</figcaption>
<div class="legend">${legend}</div>
<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escapeHtml(spec.title)}">${gridlines(spec, max)}${bars(spec, max, groupWidth)}</svg>
</figure>`;
}
