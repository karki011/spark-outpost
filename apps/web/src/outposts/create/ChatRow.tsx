import { ChatFace } from '../../brand/ChatFace.tsx';
import { FileIcon } from '../../chat/attachments/attachment-icons.tsx';
import { CommentIcon, PenIcon, XIcon } from '../../ui/icons.tsx';
import type { ChatDraft } from './create-draft.ts';
import type { ChatView } from './create-labels.ts';
import type { ChatProblem } from './create-problems.ts';
import { firstMessageOf } from './create-request.ts';
import { HandleInput } from './HandleInput.tsx';
import { ProblemLine } from './ProblemLine.tsx';

interface ChatRowProps {
  chat: ChatDraft;
  view: ChatView;
  problems: readonly ChatProblem[];
  onHandle: (typed: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}

export function ChatRow({ chat, view, problems, onHandle, onEdit, onRemove }: ChatRowProps) {
  const message = firstMessageOf(chat);
  const handleProblem = problems.find((problem) => problem.field === 'handle') ?? null;
  const problemId = `op-row-problem-${chat.key}`;
  return (
    <div className="op-chat-row" data-chat={view.faceId}>
      <ChatFace chatId={view.faceId} size="strip" />
      <HandleInput
        value={chat.handle}
        label={`Handle for ${view.title}`}
        invalid={handleProblem !== null}
        describedBy={problems.length > 0 ? problemId : undefined}
        onChange={onHandle}
      />
      <span className="op-chat-text">
        <b>
          <span>{view.title}</span>
          <i className="op-tag">{view.tag}</i>
        </b>
        <small>{view.meta}</small>
      </span>
      {message && (
        <span className="op-chat-mark">
          <CommentIcon />
          First message
          {message.attachmentIds.length > 0 && (
            <>
              <FileIcon />
              <span>
                {message.attachmentIds.length}
                <span className="sr-only">
                  {message.attachmentIds.length === 1 ? ' file' : ' files'}
                </span>
              </span>
            </>
          )}
        </span>
      )}
      <button type="button" className="icon-btn" aria-label={`Edit ${view.title}`} onClick={onEdit}>
        <PenIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Remove ${view.title}`}
        onClick={onRemove}
      >
        <XIcon />
      </button>
      {problems.length > 0 && (
        <div id={problemId} className="op-chat-problems">
          {problems.map((problem) => (
            <ProblemLine key={problem.field} problem={problem} onSuggestion={onHandle} />
          ))}
        </div>
      )}
    </div>
  );
}
