export function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern
      id={id}
      width="6"
      height="6"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <rect
        width="6"
        height="6"
        style={{ fill: `color-mix(in srgb, ${color} 22%, var(--panel))` }}
      />
      <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: color }} strokeWidth="2.4" />
    </pattern>
  );
}

export function DotPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse">
      <rect
        width="5"
        height="5"
        style={{ fill: `color-mix(in srgb, ${color} 30%, var(--panel))` }}
      />
      <circle cx="2.5" cy="2.5" r="1.3" style={{ fill: color }} />
    </pattern>
  );
}
