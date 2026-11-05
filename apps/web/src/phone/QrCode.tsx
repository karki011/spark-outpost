import { useMemo } from 'react';
import { qrMatrix } from './qr-matrix.ts';

export function QrCode({ text, label }: { text: string; label: string }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  return (
    <svg
      className="ph-qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      shapeRendering="crispEdges"
    >
      <rect className="ph-qr-paper" width={matrix.size} height={matrix.size} />
      <path className="ph-qr-ink" d={matrix.path} />
    </svg>
  );
}
