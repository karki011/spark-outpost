import { useId, useState } from 'react';
import { FileIcon } from '../../chat/attachments/attachment-icons.tsx';
import { InfoIcon, MoveIcon } from '../../ui/icons.tsx';
import { MemberFace } from '../MemberFace.tsx';
import type { ChatDraft } from './create-draft.ts';
import { filesCount, type ChatView } from './create-labels.ts';
import type { ChatProblem } from './create-problems.ts';
import { HandleInput } from './HandleInput.tsx';
import { ProblemLine } from './ProblemLine.tsx';
import type { OrderParts } from './story-draft.ts';

const LONG_MESSAGE = 160;
const LEAD_META = 'Joins the outpost and gets one wrap-up when its sub-chats end';

interface DraftCardProps {
  chat: ChatDraft;
  view: ChatView;
  lead: boolean;
  order: OrderParts;
  pull: string | null;
  warning: string | null;
  problems: readonly ChatProblem[];
  onHandle: (typed: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}

function MessagePreview({ text, files }: { text: string; files: number }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const long = text.length > LONG_MESSAGE || text.includes('\n');
  return (
    <div className="op-draft-message">
      <span className="op-draft-label">First message</span>
      <p id={id} className={long && !all ? 'clamped' : undefined}>
        {text}
      </p>
      <div className="op-draft-message-foot">
        {files > 0 && (
          <span className="op-review-files">
            <FileIcon />
            {filesCount(files)}
          </span>
        )}
        {long && (
          <button
            type="button"
            className="op-link"
            aria-expanded={all}
            aria-controls={id}
            onClick={() => setAll((shown) => !shown)}
          >
            {all ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
    </div>
  );
}

function OrderLine({ order, pull }: { order: OrderParts; pull: string | null }) {
  return (
    <p className="op-draft-order">
      {order.after === null ? (
        <b>Starts right away</b>
      ) : (
        <span className="op-draft-after">
          <MoveIcon />
          Starts after @{order.after}
        </span>
      )}
      {[order.detail, pull].filter(Boolean).map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  );
}

export function DraftCard(props: DraftCardProps) {
  const { chat, view, lead, problems } = props;
  const problemId = `op-draft-problem-${chat.key}`;
  const message = chat.text.trim();
  return (
    <div className="op-draft-card" data-chat={view.faceId}>
      <div className="op-draft-top">
        <MemberFace chatId={view.faceId} size="strip" />
        <div className="op-draft-who">
          <h4 className="op-draft-title">
            {view.title} <i className="op-tag">{lead ? 'Proposing chat' : view.tag}</i>
          </h4>
          <p className="op-draft-meta">{lead ? LEAD_META : view.meta}</p>
        </div>
        {!lead && (
          <div className="op-draft-acts">
            <button
              type="button"
              className="op-link"
              aria-label={`Edit ${view.title}`}
              onClick={props.onEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="op-link plain"
              aria-label={`Remove ${view.title}`}
              onClick={props.onRemove}
            >
              Remove
            </button>
          </div>
        )}
      </div>
      <div className="op-draft-row">
        <HandleInput
          value={chat.handle}
          label={`Handle for ${view.title}`}
          invalid={problems.some((problem) => problem.field === 'handle')}
          describedBy={problems.length > 0 ? problemId : undefined}
          onChange={props.onHandle}
        />
        {!lead && <OrderLine order={props.order} pull={props.pull} />}
      </div>
      {message !== '' && <MessagePreview text={message} files={chat.files.length} />}
      {props.warning && (
        <p className="op-review-order warn">
          <InfoIcon />
          <span>{props.warning}</span>
        </p>
      )}
      {problems.length > 0 && (
        <div id={problemId} className="op-chat-problems">
          {problems.map((problem) => (
            <ProblemLine key={problem.field} problem={problem} onSuggestion={props.onHandle} />
          ))}
        </div>
      )}
    </div>
  );
}
