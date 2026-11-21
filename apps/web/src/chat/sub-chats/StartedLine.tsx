import './sub-chats.css';
import { createContext, useContext } from 'react';
import { startedSubChatsLine, type SubChatsStart } from '@spark-outpost/contracts';
import { BranchIcon } from '../../ui/icons.tsx';

export const OpenSubChatsContext = createContext<(() => void) | null>(null);

function startedText(start: SubChatsStart): string | null {
  if (start.subChats.length === 0) return null;
  return startedSubChatsLine(start.subChats.map((chat) => chat.title));
}

function heldText(start: SubChatsStart): string | null {
  const held = start.subChats.filter((chat) => chat.held);
  if (held.length === 0) return null;
  return `Held until what they wait for has reported: ${held.map((chat) => chat.title).join(', ')}`;
}

interface StartedLinesProps {
  starts: readonly SubChatsStart[] | undefined;
  runIds: readonly string[];
}

export function StartedLines({ starts, runIds }: StartedLinesProps) {
  const openSubChats = useContext(OpenSubChatsContext);
  const shown = (starts ?? []).filter((start) => runIds.includes(start.runId));
  return shown.map((start, index) => {
    const text = startedText(start);
    const held = heldText(start);
    return (
      <div key={`${start.runId}:${index}`} className="sc-started">
        {text && (
          <p className="sc-started-line">
            <BranchIcon />
            <span>{text}</span>
            {openSubChats && (
              <button
                type="button"
                className="sc-link"
                aria-label="Open the Sub-chats tab"
                onClick={openSubChats}
              >
                Sub-chats ›
              </button>
            )}
          </p>
        )}
        {held && <p className="sc-started-note">{held}</p>}
        {start.notStarted.map((piece) => (
          <p key={piece.title} className="sc-started-note" role="status">
            Not started: {piece.title}. {piece.reason}
          </p>
        ))}
      </div>
    );
  });
}
