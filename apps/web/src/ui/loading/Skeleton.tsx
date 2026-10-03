import './loading.css';

export type SkeletonShape = 'lines' | 'list' | 'diff' | 'cards';

const WIDTHS = ['72%', '54%', '86%', '61%', '78%', '47%', '66%', '58%'];

function Row({ shape, index }: { shape: SkeletonShape; index: number }) {
  const width = WIDTHS[index % WIDTHS.length];
  if (shape === 'lines') return <span className="skel-bar" style={{ width }} />;
  if (shape === 'diff') {
    return (
      <span className="skel-dline">
        <span className="skel-bar skel-gutter" />
        <span className="skel-bar" style={{ width }} />
      </span>
    );
  }
  if (shape === 'cards') {
    return (
      <span className="skel-card">
        <span className="skel-bar" style={{ width: '42%' }} />
        <span className="skel-bar" style={{ width }} />
      </span>
    );
  }
  return (
    <span className="skel-row">
      <span className="skel-bar skel-icon" />
      <span className="skel-bar" style={{ width }} />
      <span className="skel-bar skel-meta" />
    </span>
  );
}

interface SkeletonProps {
  label: string;
  shape?: SkeletonShape;
  rows?: number;
  className?: string;
}

export function Skeleton({ label, shape = 'lines', rows = 4, className }: SkeletonProps) {
  return (
    <div className={className ? `skel skel-${shape} ${className}` : `skel skel-${shape}`}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <span className="skel-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <Row key={index} shape={shape} index={index} />
        ))}
      </span>
    </div>
  );
}
