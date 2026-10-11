import { XIcon } from '../ui/icons.tsx';

interface AsksLineProps {
  id: string;
  handles: readonly string[];
  paused: boolean;
  onSkip: (handle: string) => void;
}

function pausedNote(handles: readonly string[]): string {
  const who = handles.length === 1 ? `@${handles[0]} gets` : 'They get';
  return `Paused. ${who} this when you resume.`;
}

export function AsksLine({ id, handles, paused, onSkip }: AsksLineProps) {
  return (
    <div id={id} className="op-asks" role="group" aria-label="Chats this message asks">
      <span>Asks:</span>
      {handles.map((handle) => (
        <span key={handle} className="op-ask">
          @{handle}
          <button
            type="button"
            className="op-ask-skip"
            aria-label={`Do not ask @${handle}`}
            title={`Do not ask @${handle}`}
            onClick={() => onSkip(handle)}
          >
            <XIcon />
          </button>
        </span>
      ))}
      {paused && <span>{pausedNote(handles)}</span>}
    </div>
  );
}
