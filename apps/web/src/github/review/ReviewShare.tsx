import { useState } from 'react';
import type { GithubInboxItem, GithubReview } from '@spark-outpost/contracts';
import { api, newDraftId } from '../../api/client.ts';
import { queueDraftWithFiles } from '../../chat/composer/pending-draft.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { Glyph } from '../../tickets/ticket-icons.tsx';
import { CopyIcon } from '../../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { chatOpening, reviewFileName, reviewMarkdown, reviewNote } from './review-share.ts';

async function sendToChat(item: GithubInboxItem, review: GithubReview): Promise<string> {
  const file = new File([reviewNote(item, review)], reviewFileName(item), {
    type: 'text/markdown',
  });
  if (item.conversationId) {
    queueDraftWithFiles(item.conversationId, '', [file]);
    return item.conversationId;
  }
  const id = newDraftId();
  if (item.projectId) await api.updateChatSettings(id, { projectIds: [item.projectId] });
  queueDraftWithFiles(id, chatOpening(item), [file]);
  return id;
}

interface ReviewShareProps {
  item: GithubInboxItem;
  review: GithubReview;
  onOpenChat: (conversationId: string) => void;
}

export function ReviewShare({ item, review, onOpenChat }: ReviewShareProps) {
  const { remote } = useRemoteClient();
  const { state, copy } = useCopyFeedback();
  const [problem, setProblem] = useState<string | null>(null);
  if (review.state !== 'done' || !review.body?.trim()) return null;

  const send = async () => {
    setProblem(null);
    try {
      onOpenChat(await sendToChat(item, review));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The review could not go to a chat.');
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn line sm gh-review-btn"
        onClick={() => copy(reviewMarkdown(item, review))}
      >
        <CopyIcon />
        {state === 'idle' ? 'Copy review' : copyButtonText(state)}
      </button>
      {!remote && (
        <button type="button" className="btn line sm gh-review-btn" onClick={() => void send()}>
          <Glyph name="chat" size={13} />
          Send to chat
        </button>
      )}
      {problem && (
        <p className="gh-review-error" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}
