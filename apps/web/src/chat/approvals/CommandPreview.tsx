import { useId, useState } from 'react';

const SHOWN_LINES = 6;

export function CommandPreview({ command }: { command: string }) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const lines = command.split('\n').length;
  const long = lines > SHOWN_LINES;
  const clipped = long && !open;
  return (
    <div className={clipped ? 'appr-cmd-wrap clipped' : 'appr-cmd-wrap'}>
      <pre id={previewId} className="appr-cmd">
        {command}
      </pre>
      {long && (
        <button
          type="button"
          className="btn ghost sm appr-cmd-more"
          aria-expanded={open}
          aria-controls={previewId}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : `Show all (${lines} lines)`}
        </button>
      )}
    </div>
  );
}
