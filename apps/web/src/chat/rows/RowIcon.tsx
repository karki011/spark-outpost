const PATHS = {
  read: ['M4 3h6l3 3v11H4z', 'M10 3v3h3'],
  search: ['M12 12l4 4', 'M8.5 4a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z'],
  edit: ['M4 16l1-4 8-8 3 3-8 8z', 'M11 6l3 3'],
  run: [
    'M4.5 3.5h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z',
    'M6 8l2.5 2L6 12M10 12h4',
  ],
  think: ['M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z', 'M8 17h4'],
  web: [
    'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
    'M3 10h14M10 3c2.5 2.5 2.5 11.5 0 14M10 3c-2.5 2.5-2.5 11.5 0 14',
  ],
  browser: ['M3 4.5h14v11H3z', 'M3 8h14', 'M5.5 6.25h.5M7.75 6.25h.5'],
  page: ['M4 4h12v12H4z', 'M4 8h12', 'M8.5 8v8'],
  mac: ['M5 3.5l10 6-4.6 1.1 2.6 4.6-1.9 1.1-2.6-4.6L5 14.5z'],
  todo: ['M8 5h9M8 10h9M8 15h9', 'M3.6 5h.8M3.6 10h.8M3.6 15h.8'],
  files: ['M6 3h5l3 3v8H6z', 'M4 6v11h8'],
  flag: ['M5 17V3M5 4h9l-2 3 2 3H5'],
  publish: [
    'M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM14 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M6 7v6M14 13V8a2 2 0 0 0-2-2H9',
    'M10.5 4.5L9 6l1.5 1.5',
  ],
  other: ['M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
} as const;

export type RowIconName = keyof typeof PATHS;

export function RowIcon({ name }: { name: RowIconName }) {
  return (
    <svg
      className="row-ico"
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
