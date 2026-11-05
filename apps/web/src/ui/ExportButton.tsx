import { useId, useRef, useState } from 'react';
import { DownloadIcon } from './icons.tsx';
import { saveResponse } from './save-response.ts';

type Phase = 'idle' | 'preparing' | 'saving';

const BUSY_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  preparing: 'Preparing…',
  saving: 'Saving…',
};

function failureText(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Spark couldn't export this (${reason.replace(/\.$/, '')}). Try again.`;
}

export function ExportButton({
  url,
  fileName,
  label,
  primary = false,
}: {
  url: string;
  fileName: string;
  label: string;
  primary?: boolean;
}) {
  const errorId = useId();
  const running = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setPhase('preparing');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The server responded with ${response.status}.`);
      setPhase('saving');
      await saveResponse(response, fileName);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      running.current = false;
      setPhase('idle');
    }
  };

  const busy = phase !== 'idle';
  return (
    <>
      <button
        type="button"
        className={primary ? 'btn primary sm' : 'btn line sm'}
        aria-disabled={busy}
        aria-busy={busy}
        aria-describedby={error ? errorId : undefined}
        onClick={() => void run()}
      >
        <DownloadIcon />
        {busy ? BUSY_LABEL[phase] : label}
      </button>
      {error && (
        <p id={errorId} className="xerr" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
