import { useId, useState } from 'react';
import { PickElementIcon } from '../../browser/BrowserIcons.tsx';
import { XIcon } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { ProgressRing } from './attachment-icons.tsx';

interface PickChipProps {
  label: string;
  picture: string | null;
  text: string | null;
  uploading?: number | null;
  onRemove?: () => void;
}

export function PickChip({ label, picture, text, uploading = null, onRemove }: PickChipProps) {
  const [open, setOpen] = useState(false);
  const detail = useId();
  return (
    <div
      className="pick"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <div className="chip att-chip pick-chip" aria-busy={uploading !== null}>
        <button
          type="button"
          className="pick-toggle"
          aria-expanded={open}
          aria-controls={detail}
          title="Show what the agent gets"
          onClick={() => setOpen(!open)}
        >
          {uploading !== null ? (
            <ProgressRing progress={uploading} label={`Uploading ${label}`} />
          ) : picture ? (
            <img src={picture} alt="" />
          ) : (
            <PickElementIcon />
          )}
          <span className="att-name">{label}</span>
        </button>
        {onRemove && (
          <button
            type="button"
            className="chip-x"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <XIcon />
          </button>
        )}
      </div>
      {open && (
        <div
          id={detail}
          className="pick-detail"
          role="group"
          aria-label={`What the agent gets: ${label}`}
        >
          <p>
            The agent gets {picture ? 'this picture and the note below' : 'the note below'}, marked
            as untrusted page data.
          </p>
          {picture && <img src={picture} alt={`Picture of ${label}`} />}
          {text === null ? (
            <Skeleton label="Reading the note" rows={4} />
          ) : (
            <pre tabIndex={0}>{text}</pre>
          )}
        </div>
      )}
    </div>
  );
}
