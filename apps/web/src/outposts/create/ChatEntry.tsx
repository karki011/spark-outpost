import { useEffect } from 'react';
import type { Attachment } from '@spark-outpost/contracts';
import { useAttachments } from '../../chat/attachments/use-attachments.ts';
import type { ChatDraft } from './create-draft.ts';
import type { ChatView } from './create-labels.ts';
import type { ChatProblem } from './create-problems.ts';
import { ChatForm, type ChatFormActions } from './ChatForm.tsx';
import { ChatRow } from './ChatRow.tsx';
import type { AfterChoice } from './story-draft.ts';
import type { CreateData } from './use-create-data.ts';

interface ChatEntryProps extends ChatFormActions {
  chat: ChatDraft;
  number: number;
  view: ChatView;
  data: CreateData;
  taken: ReadonlySet<string>;
  after: readonly AfterChoice[] | null;
  stackedOn: string | null;
  afterHandle: string | null;
  problems: readonly ChatProblem[];
  finished: boolean;
  focusOnMount: boolean;
  onFiles: (files: Attachment[], pending: boolean) => void;
  onEdit: () => void;
}

export function ChatEntry({ onFiles, onEdit, afterHandle, ...props }: ChatEntryProps) {
  const attachments = useAttachments();
  const { uploaded } = attachments;
  const pending = attachments.uploading || attachments.failed;

  useEffect(() => {
    onFiles(uploaded, pending);
  }, [onFiles, uploaded, pending]);

  return (
    <li>
      {props.chat.open ? (
        <ChatForm {...props} attachments={attachments} />
      ) : (
        <ChatRow
          chat={props.chat}
          view={props.view}
          afterHandle={afterHandle}
          problems={props.problems}
          onHandle={props.onHandle}
          onEdit={onEdit}
          onRemove={props.onRemove}
        />
      )}
    </li>
  );
}
