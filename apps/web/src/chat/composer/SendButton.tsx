interface SendButtonProps {
  busy: boolean;
  stopping?: boolean;
  label: string;
  disabled: boolean;
  onSend: () => void;
  onStop: () => void;
  onQueue?: () => void;
}

export function SendButton({
  busy,
  stopping = false,
  label,
  disabled,
  onSend,
  onStop,
  onQueue,
}: SendButtonProps) {
  if (busy) {
    return (
      <>
        <span className="stopping-note" role="status">
          {stopping ? 'Stopping…' : ''}
        </span>
        {onQueue && (
          <button
            type="button"
            className="send queue"
            aria-label="Queue message"
            title="Queue: sends when this turn ends"
            disabled={disabled}
            onClick={onQueue}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 4.5h10M3 8h10M3 11.5h5.5M11.5 10v4M9.5 12h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        <StopButton stopping={stopping} onStop={onStop} />
      </>
    );
  }
  return (
    <button
      type="button"
      className="send"
      aria-label={label}
      title={label === 'Send' ? undefined : label}
      disabled={disabled}
      onClick={onSend}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    </button>
  );
}

function StopButton({ stopping, onStop }: { stopping: boolean; onStop: () => void }) {
  return (
    <button
      type="button"
      className={stopping ? 'send busy stopping' : 'send busy'}
      aria-label={stopping ? 'Stopping…' : 'Stop'}
      aria-disabled={stopping}
      onClick={() => {
        if (!stopping) onStop();
      }}
    >
      <svg className="stop-ring" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="14" />
      </svg>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="0.5" y="0.5" width="9" height="9" rx="2" fill="currentColor" />
      </svg>
    </button>
  );
}
