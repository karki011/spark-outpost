const COLORS: Record<string, string> = {
  good: 'var(--success)',
  mixed: 'var(--warn)',
  unclear: 'var(--muted)',
  bad: 'var(--danger)',
};

export function verdictColor(verdict: string): string {
  return COLORS[verdict] ?? 'var(--muted)';
}

export function VerdictShape({
  verdict,
  x,
  y,
  r = 4.5,
}: {
  verdict: string;
  x: number;
  y: number;
  r?: number;
}) {
  const color = verdictColor(verdict);
  if (verdict === 'good')
    return <circle className="an-pt" cx={x} cy={y} r={r} style={{ fill: color }} />;
  if (verdict === 'bad') {
    const s = r * 0.95;
    return (
      <path
        className="an-pt an-pt-x"
        d={`M${x - s},${y - s}L${x + s},${y + s}M${x + s},${y - s}L${x - s},${y + s}`}
        style={{ stroke: color }}
      />
    );
  }
  if (verdict === 'mixed') {
    const s = r * 1.25;
    return (
      <path
        className="an-pt"
        d={`M${x},${y - s}L${x + s},${y}L${x},${y + s}L${x - s},${y}Z`}
        style={{ fill: color }}
      />
    );
  }
  return (
    <circle className="an-pt an-pt-ring" cx={x} cy={y} r={r - 0.5} style={{ stroke: color }} />
  );
}

export function ShapeLegend() {
  return (
    <ul className="an-legend">
      {(['good', 'mixed', 'unclear', 'bad'] as const).map((verdict) => (
        <li key={verdict}>
          <svg width="14" height="14" aria-hidden="true">
            <VerdictShape verdict={verdict} x={7} y={7} />
          </svg>
          {verdict.charAt(0).toUpperCase() + verdict.slice(1)}
        </li>
      ))}
    </ul>
  );
}
