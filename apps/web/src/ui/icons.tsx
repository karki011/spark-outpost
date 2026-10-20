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

export function MicIcon() {
  return (
    <StrokeIcon path="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3" />
  );
}

export function KeyIcon() {
  return <StrokeIcon path="M12 15a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1-3 9-9M17 6l3 3" />;
}

export function FolderIcon() {
  return (
    <StrokeIcon path="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  );
}

export function OutpostIcon() {
  return <StrokeIcon path="M6 21V4M6 5h11l-2.5 3.5L17 12H6" />;
}

export function PauseIcon() {
  return <StrokeIcon path="M9 5v14M15 5v14" />;
}

export function ResumeIcon() {
  return <StrokeIcon path="M7 5l12 7-12 7z" />;
}

export function ParentFolderIcon() {
  return <StrokeIcon path="M12 19V6M6 11l6-6 6 6" />;
}

export function BranchIcon() {
  return (
    <StrokeIcon path="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9" />
  );
}

export function MergedIcon() {
  return (
    <StrokeIcon path="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21V9a9 9 0 0 0 9 9" />
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

export function EyeIcon() {
  return (
    <StrokeIcon path="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
  );
}

export function EyeOffIcon() {
  return (
    <StrokeIcon path="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.4 3.2M6.2 7.4A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.8-1.4M10 10.3a2.5 2.5 0 0 0 3.7 3.4M4 4l16 16" />
  );
}

export function UnlockIcon() {
  return <StrokeIcon path="M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2" />;
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

export function RefreshIcon() {
  return (
    <StrokeIcon path="M20 11a8 8 0 0 0-14.6-3.5M4 4v4h4M4 13a8 8 0 0 0 14.6 3.5M20 20v-4h-4" />
  );
}

export function ExpandIcon() {
  return <StrokeIcon path="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />;
}

export function ShrinkIcon() {
  return <StrokeIcon path="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />;
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

export function BookIcon() {
  return (
    <StrokeIcon path="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6" />
  );
}

export function SearchIcon() {
  return <StrokeIcon path="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-3.5-3.5" />;
}

export function SessionsIcon() {
  return <StrokeIcon path="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />;
}

export function HomeIcon() {
  return <StrokeIcon path="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />;
}

export function GearIcon() {
  return (
    <StrokeIcon path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  );
}

export function SoundIcon({ on }: { on: boolean }) {
  return (
    <StrokeIcon
      path={
        on
          ? 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'
          : 'M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6'
      }
    />
  );
}

export const CALENDAR_PATH =
  'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v4M16 3v4';

export function BellIcon() {
  return <StrokeIcon path="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />;
}

export function BellOffIcon() {
  return <StrokeIcon path="M6 16v-5a6 6 0 0 1 9-5.2M18 11v5l2 2H4M10 21h4M3 3l18 18" />;
}

export function VideoIcon() {
  return <StrokeIcon path="M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5" />;
}

export function ChatPlusIcon() {
  return <StrokeIcon path="M4 5h16v11H8l-4 4zM12 8v5M9.5 10.5h5" />;
}

export function WarnIcon() {
  return <StrokeIcon path="M12 3l9 16H3zM12 10v4M12 17h.01" />;
}

export function LockIcon() {
  return <StrokeIcon path="M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11" />;
}

export function LaptopIcon() {
  return <StrokeIcon path="M5 6h14v10H5zM3 19h18" />;
}

export function CloudIcon() {
  return <StrokeIcon path="M7 18a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6-1.5A4.5 4.5 0 0 1 17 18z" />;
}

export function ClockIcon() {
  return <StrokeIcon path="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" />;
}

export function PeopleIcon() {
  return (
    <StrokeIcon path="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" />
  );
}
