import type { ConversationSummary } from '@spark-outpost/contracts';
import { ChatFace } from '../brand/ChatFace.tsx';
import type { ChatFaceState } from '../brand/chat-face.ts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';

const DRAWN = 22;

interface RowFaceProps {
  chat: ConversationSummary;
  state: ChatFaceState;
}

export function RowFace({ chat, state }: RowFaceProps) {
  if (!chat.teammate) return <ChatFace chatId={chat.id} state={state} size="row" />;
  return (
    <span className="rface" aria-hidden="true">
      <TeammateFace
        face={chat.teammate.face}
        size={DRAWN}
        state={state === 'archived' ? 'idle' : state}
      />
    </span>
  );
}
