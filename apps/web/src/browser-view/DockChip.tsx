import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { GlobeIcon } from '../browser/BrowserIcons.tsx';

interface DockChipProps {
  label: string;
  detail: string;
  removeLabel: string;
  onRemove(): void;
}

export function DockChip({ label, detail, removeLabel, onRemove }: DockChipProps) {
  return (
    <li className="pcd-chip">
      <GlobeIcon />
      <span className="pcd-chip-name">{label}</span>
      <span className="pcd-chip-kind">{detail}</span>
      <button
        type="button"
        className="icon-btn pcd-chip-x"
        aria-label={removeLabel}
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </li>
  );
}
