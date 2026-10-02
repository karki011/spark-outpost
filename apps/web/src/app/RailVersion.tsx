import { useUpdateStatus } from '../desktop/use-update-status.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { downloadPercent } from './update-blob-state.ts';

export function RailVersion() {
  const status = useUpdateStatus();
  if (!status) return null;
  const parts = [`v${status.currentVersion}`];
  if (status.devBuild) parts.push('dev');
  const percent = downloadPercent(status);
  if (percent !== null) parts.push(`${percent}%`);
  return (
    <button
      type="button"
      className="rail-ver"
      aria-label={`App version ${parts.join(' · ')}`}
      onClick={() => requestSettings('updates')}
    >
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && '· '}
          {part}
        </span>
      ))}
    </button>
  );
}
