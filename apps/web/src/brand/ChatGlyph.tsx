import './chat-glyph.css';
import { ArchiveIcon, CommentIcon, SpinnerIcon, StrokeIcon, WarnIcon } from '../ui/icons.tsx';
import type { ChatFaceState } from './chat-face.ts';

const DRAWN = { row: 18, post: 20, strip: 28 } as const;
type ChatGlyphSize = keyof typeof DRAWN;

const DONE_PATH = 'm5 12 5 5 9-10';
const FAILED_PATH = 'M6 6l12 12M18 6 6 18';

function glyph(state: ChatFaceState) {
  if (state === 'working') return <SpinnerIcon />;
  if (state === 'needs_you') return <WarnIcon />;
  if (state === 'done') return <StrokeIcon path={DONE_PATH} />;
  if (state === 'failed') return <StrokeIcon path={FAILED_PATH} />;
  if (state === 'archived') return <ArchiveIcon />;
  return <CommentIcon />;
}

interface ChatGlyphProps {
  size: ChatGlyphSize;
  state?: ChatFaceState;
  label?: string | undefined;
}

export function ChatGlyph({ size, state = 'idle', label }: ChatGlyphProps) {
  const naming = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <span
      className="chat-glyph"
      data-size={size}
      data-state={state}
      style={{ width: DRAWN[size], height: DRAWN[size] }}
      {...naming}
    >
      {glyph(state)}
    </span>
  );
}
