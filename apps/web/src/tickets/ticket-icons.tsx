const PATHS = {
  ticket:
    'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM10 9v6',
  linear: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  redo: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  warn: 'M12 4 2.5 20h19zM12 10v4M12 17h.01',
  play: 'M7 5v14l11-7z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  pr: 'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7v10M18 17v-7a3 3 0 0 0-3-3h-3M14 5l-2 2 2 2',
  assign: 'M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21a7 7 0 0 1 11-5.7M19 14v6M16 17h6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  snooze: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  home: 'M3 11 12 4l9 7v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  box: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 11h16',
  'pr-draft':
    'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7v10M18 14v.01M18 10v.01M18 6v.01',
  'pr-merged':
    'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7v10M6 7a8 8 0 0 0 10 6',
  'pr-closed':
    'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 7v10M18 17v-5M15.5 4.5l5 5M20.5 4.5l-5 5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  blocked: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  'x-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6',
};

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 14 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const TicketGlyph = ({ size = 16 }: { size?: number }) => (
  <Glyph name="ticket" size={size} />
);
export const LinearMark = () => <Glyph name="linear" size={16} />;

const PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

export function PriorityGlyph({ rank }: { rank: number }) {
  const name = PRIORITY_NAMES[rank] ?? 'No priority';
  if (rank === 1) {
    return (
      <span className="pri urgent" title={name} role="img" aria-label={name}>
        !
      </span>
    );
  }
  const bars = rank === 2 ? 3 : rank === 3 ? 2 : rank === 4 ? 1 : 0;
  return (
    <span className={rank === 2 ? 'pri high' : 'pri'} title={name} role="img" aria-label={name}>
      {[0, 1, 2].map((index) => (
        <i key={index} className={index < bars ? 'on' : undefined} />
      ))}
    </span>
  );
}
