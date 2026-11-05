import type { CSSProperties, ReactNode } from 'react';
import './analytics-skeleton.css';

function block(style: CSSProperties) {
  return <span className="an-skel" style={style} aria-hidden="true" />;
}

export function SkeletonCard({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={wide ? 'an-card an-wide an-skel-card' : 'an-card an-skel-card'}
      aria-busy="true"
    >
      <span className="sr-only">Loading {title}…</span>
      <header className="an-card-h">{block({ width: 160, height: 15 })}</header>
      {block({ width: '80%', height: 12, marginTop: 8, marginBottom: 14 })}
      {children}
    </section>
  );
}

export function SkelHeatmap() {
  const cells = Array.from({ length: 7 * 14 });
  return (
    <div className="an-skel-heat" aria-hidden="true">
      {cells.map((_, index) => (
        <span
          key={index}
          className="an-skel"
          style={{ animationDelay: `${(index % 14) * 25}ms` }}
        />
      ))}
    </div>
  );
}

export function SkelChartArea({ height = 180 }: { height?: number }) {
  return <div className="an-skel an-fill" style={{ height }} aria-hidden="true" />;
}

export function SkelTreemap() {
  return (
    <div className="an-skel-tree" aria-hidden="true">
      {block({ gridArea: 'a' })}
      {block({ gridArea: 'b' })}
      {block({ gridArea: 'c' })}
      {block({ gridArea: 'd' })}
    </div>
  );
}

export function SkelBars({ rows }: { rows: number }) {
  return (
    <div className="an-skel-bars" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="an-skel" style={{ width: `${85 - index * 14}%` }} />
      ))}
    </div>
  );
}

export function SkelRings({ count = 2 }: { count?: number }) {
  return (
    <div className="an-skel-rings" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="an-skel an-skel-ring" />
      ))}
    </div>
  );
}

export function SkelTableRows({ rows }: { rows: number }) {
  return (
    <div className="an-skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="an-skel" />
      ))}
    </div>
  );
}
