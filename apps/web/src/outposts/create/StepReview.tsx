import './story-fields.css';
import { MemberFace } from '../MemberFace.tsx';
import { FileIcon } from '../../chat/attachments/attachment-icons.tsx';
import { CommentIcon, InfoIcon } from '../../ui/icons.tsx';
import { listedChats, type CreateDraft } from './create-draft.ts';
import { chatView, filesCount, startLines } from './create-labels.ts';
import { messageExcerpt, startSummary } from './create-request.ts';
import { isLead, orderLine, pullLine, storyStartLines, unpushedParent } from './story-draft.ts';
import type { CreateData } from './use-create-data.ts';

interface StepReviewProps {
  draft: CreateDraft;
  data: CreateData;
  onEditName: () => void;
  onEditChats: () => void;
}

export function StepReview({ draft, data, onEditName, onEditChats }: StepReviewProps) {
  const chats = listedChats(draft);
  const fromDraft = draft.origin !== undefined;
  const storyLine = (chat: (typeof chats)[number]) => {
    if (isLead(draft, chat)) return 'Proposed these chats';
    const pull = pullLine(draft, chat, data.chats, data.level);
    return [orderLine(draft, chat, data.chats), pull].filter(Boolean).join(' · ');
  };
  return (
    <section className="op-step" aria-label="Review">
      <p className="op-review-name">
        <span>Name</span>
        <b>{draft.name.trim()}</b>
        <button type="button" className="op-link" aria-label="Edit name" onClick={onEditName}>
          Edit
        </button>
      </p>
      <div className="op-review-head">
        <h3 className="op-step-title">Chats</h3>
        <button type="button" className="op-link" aria-label="Edit chats" onClick={onEditChats}>
          Edit
        </button>
      </div>
      {chats.length === 0 ? (
        <p className="op-sheet-empty">No chats yet. You can add them after the outpost starts.</p>
      ) : (
        <ul className="op-review-list">
          {chats.map((chat) => {
            const view = chatView(chat, { ...data, agent: data.agentOf(chat) });
            const excerpt = messageExcerpt(chat);
            const warning = unpushedParent(draft, chat, data.chats, data.level);
            return (
              <li key={chat.key}>
                <MemberFace chatId={view.faceId} size="strip" />
                <b className="op-review-handle">@{chat.handle}</b>
                <span className="op-chat-text">
                  <b>
                    <span>{view.title}</span>
                    <i className="op-tag">{view.tag}</i>
                  </b>
                  <small>{view.meta}</small>
                </span>
                {excerpt && (
                  <p className="op-review-message">
                    <CommentIcon />
                    <span>{excerpt}</span>
                    {chat.files.length > 0 && (
                      <span className="op-review-files">
                        <FileIcon />
                        {filesCount(chat.files.length)}
                      </span>
                    )}
                  </p>
                )}
                {fromDraft && <p className="op-review-order">{storyLine(chat)}</p>}
                {warning && (
                  <p className="op-review-order warn">
                    <InfoIcon />
                    <span>{warning}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="op-step-title">When you start</h3>
      <ul className="op-start-lines">
        {[...startLines(startSummary(draft)), ...storyStartLines(draft)].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
