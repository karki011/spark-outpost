function OutlineIcon({ path }: { path: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function QuoteIcon() {
  return <OutlineIcon path="M4 11h5v6H4v-6Zm0 0c0-3 1-5 4-6M14 11h5v6h-5v-6Zm0 0c0-3 1-5 4-6" />;
}

export function AskIcon() {
  return (
    <OutlineIcon path="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12ZM10 9.5a2.2 2.2 0 1 1 3 2c-.6.3-1 .8-1 1.5M12 16h.01" />
  );
}

export function CopyIcon() {
  return (
    <OutlineIcon path="M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  );
}
