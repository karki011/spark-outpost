import { useId, useRef } from 'react';
import { AttachmentChips } from '../../chat/attachments/AttachmentChips.tsx';
import type { AttachmentsState } from '../../chat/attachments/use-attachments.ts';
import { PlusIcon } from '../../ui/icons.tsx';

interface FirstMessageProps {
  open: boolean;
  text: string;
  handle: string;
  attachments: AttachmentsState;
  problem: string | null;
  onOpen: (open: boolean) => void;
  onText: (text: string) => void;
}

const ROWS = 3;

export function FirstMessage({
  open,
  text,
  handle,
  attachments,
  problem,
  onOpen,
  onText,
}: FirstMessageProps) {
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  if (!open) {
    return (
      <button type="button" className="op-add-message" onClick={() => onOpen(true)}>
        <PlusIcon />
        Add a first message
        <small>Optional</small>
      </button>
    );
  }

  const remove = () => {
    attachments.clear();
    onText('');
    onOpen(false);
  };

  return (
    <div className="op-message">
      <div className="op-message-head">
        <label htmlFor={`${ids}text`}>
          First message <small>Optional</small>
        </label>
        <button type="button" className="op-link" onClick={remove}>
          Remove
        </button>
      </div>
      <div className="op-message-box">
        <AttachmentChips
          items={attachments.items}
          onRemove={attachments.remove}
          onRetry={attachments.retry}
        />
        <textarea
          ref={textRef}
          id={`${ids}text`}
          className="inp"
          rows={ROWS}
          autoFocus
          value={text}
          placeholder="What this chat should do first"
          aria-invalid={problem !== null}
          aria-describedby={`${ids}hint${problem ? ` ${ids}problem` : ''}`}
          onChange={(event) => onText(event.target.value)}
        />
        <div className="op-message-foot">
          <button type="button" className="btn sm ghost" onClick={() => fileInput.current?.click()}>
            <PlusIcon />
            Attach files
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Attach files"
            onChange={(event) => {
              attachments.add(Array.from(event.target.files ?? []));
              event.target.value = '';
              textRef.current?.focus();
            }}
          />
          <small id={`${ids}hint`}>
            {handle ? `Goes to @${handle}` : 'Goes to this chat'} as its first request when the
            outpost starts
          </small>
        </div>
      </div>
      {attachments.notice && (
        <p className="op-message-note" role="status">
          {attachments.notice}
        </p>
      )}
      {problem && (
        <small id={`${ids}problem`} className="op-problem">
          {problem}
        </small>
      )}
    </div>
  );
}
