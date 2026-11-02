import './plugin-status.css';
import type { PluginScanStatus } from '@spark-outpost/contracts';
import { CheckIcon, EyeIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';

const STATUS = {
  pending: { word: 'Checking…', icon: <SpinnerIcon /> },
  clean: { word: 'Clean', icon: <CheckIcon className="" /> },
  review: { word: 'Review', icon: <EyeIcon /> },
  flagged: { word: 'Flagged', icon: <WarnIcon /> },
} as const;

export function PluginStatus({ status }: { status: PluginScanStatus }) {
  const { word, icon } = STATUS[status];
  return (
    <span className="plug-status" data-status={status}>
      {icon}
      {word}
    </span>
  );
}
