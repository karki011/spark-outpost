import '../terminal/native-terminal.css';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { ChatGlyph } from '../brand/ChatGlyph.tsx';
import type { ChatFaceState } from '../brand/chat-face.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import type { SessionState } from './island-model.ts';

const GLYPH_STATE = {
  working: 'working',
  waiting: 'needs_you',
  done: 'done',
  failed: 'failed',
  idle: 'idle',
} as const satisfies Record<SessionState, ChatFaceState>;

const GLYPH_FROM = 28;

interface SessionMarkProps {
  chat: ConversationSummary;
  state: SessionState;
  size: number;
}

export function SessionMark({ chat, state, size }: SessionMarkProps) {
  const face = GLYPH_STATE[state];
  return (
    <span
      className="isl-sblob"
      data-state={state}
      data-terminal={chat.sessionType === 'terminal' ? 'true' : undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {chat.teammate ? (
        <TeammateFace face={chat.teammate.face} size={size} state={face} />
      ) : (
        <ChatGlyph size={size >= GLYPH_FROM ? 'strip' : 'row'} state={face} />
      )}
    </span>
  );
}
