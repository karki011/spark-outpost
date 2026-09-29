export function ChevronIcon() {
  return (
    <svg
      className="chev"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ className = 'ok' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

export function XIcon() {
  return (
    <svg
      className="xic"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function TickIcon() {
  return (
    <svg className="tick" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 12 5 5 9-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SpinnerIcon() {
  return <i className="spin" aria-hidden="true" />;
}

function StrokeIcon({ path }: { path: string }) {
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

export function TerminalIcon() {
  return <StrokeIcon path="m5 8 4 4-4 4M11 17h8" />;
}

export function KeyIcon() {
  return <StrokeIcon path="M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1-3 9-9M17 6l3 3" />;
}

export function FolderIcon() {
  return (
    <StrokeIcon path="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  );
}

export function ParentFolderIcon() {
  return <StrokeIcon path="M12 19V6M6 11l6-6 6 6" />;
}

export function BranchIcon() {
  return (
    <StrokeIcon path="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9" />
  );
}

export function PlusIcon() {
  return <StrokeIcon path="M12 5v14M5 12h14" />;
}

export function ArrowUpIcon() {
  return <StrokeIcon path="M12 19V5M6 11l6-6 6 6" />;
}

export function ArrowDownIcon() {
  return <StrokeIcon path="M12 5v14M6 13l6 6 6-6" />;
}

export function PinIcon() {
  return <StrokeIcon path="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" />;
}

export function GripIcon() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="2" r="1.1" />
      <circle cx="6" cy="2" r="1.1" />
      <circle cx="2" cy="6" r="1.1" />
      <circle cx="6" cy="6" r="1.1" />
      <circle cx="2" cy="10" r="1.1" />
      <circle cx="6" cy="10" r="1.1" />
    </svg>
  );
}

export function DotsIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </svg>
  );
}

export function PenIcon() {
  return <StrokeIcon path="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />;
}

export function SparkleIcon() {
  return <StrokeIcon path="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7-5.7-1.9L10.2 9z" />;
}

export function ArchiveIcon() {
  return (
    <StrokeIcon path="M4 4h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  );
}

export function RestoreIcon() {
  return <StrokeIcon path="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />;
}

export function TrashIcon() {
  return <StrokeIcon path="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />;
}

export function MoveIcon() {
  return <StrokeIcon path="M5 12h14M13 6l6 6-6 6" />;
}

export function BackIcon() {
  return <StrokeIcon path="m15 6-6 6 6 6" />;
}

export function UnpinIcon() {
  return <StrokeIcon path="M12 17v5M9 3h6l-1 6 4 4H6l4-4zM3 3l18 18" />;
}

export function SlidersIcon() {
  return <StrokeIcon path="M7 4v5M7 13v7M17 4v9M17 17v3M4 11h6M14 15h6" />;
}

export function ShieldIcon() {
  return <StrokeIcon path="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6zM9 12l2 2 4-4" />;
}

export function ExternalLinkIcon() {
  return (
    <StrokeIcon path="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  );
}

export function DownloadIcon() {
  return <StrokeIcon path="M12 4v12M7 11l5 5 5-5M5 20h14" />;
}

export function CopyIcon() {
  return (
    <StrokeIcon path="M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  );
}

export function ThumbUpIcon() {
  return (
    <StrokeIcon path="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z" />
  );
}

export function ThumbDownIcon() {
  return (
    <StrokeIcon path="M17 14V3M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9Z" />
  );
}

export function CommentIcon() {
  return <StrokeIcon path="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
}

export function QuoteIcon() {
  return <StrokeIcon path="M4 11h5v6H4v-6Zm0 0c0-3 1-5 4-6M14 11h5v6h-5v-6Zm0 0c0-3 1-5 4-6" />;
}

export function AskIcon() {
  return (
    <StrokeIcon path="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12ZM10 9.5a2.2 2.2 0 1 1 3 2c-.6.3-1 .8-1 1.5M12 16h.01" />
  );
}

export function InfoIcon() {
  return <StrokeIcon path="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01" />;
}
