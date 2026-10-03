import './send.css';
import { MessageAttachments } from '../attachments/MessageAttachments.tsx';
import { QuotedText } from '../quotes/QuotedText.tsx';
import type { PendingSend } from './send-state.ts';
import type { ChatSends } from './use-chat-send.ts';

function SendStatus({ send, sends }: { send: PendingSend; sends: ChatSends }) {
  if (send.phase === 'starting') {
    return (
      <p className="send-status" role="status">
        Starting…
      </p>
    );
  }
  const canEdit = send.phase === 'failed' && send.message.attachments.length === 0;
  return (
    <p className="send-status send-problem" role="alert">
      <span>
        {send.phase === 'slow'
          ? 'Spark hasn’t accepted this message yet.'
          : `Not sent. ${send.error ?? 'The server could not be reached.'}`}
      </span>
      <button type="button" className="send-action" onClick={() => sends.retry(send.message)}>
        Retry
      </button>
      {canEdit && (
        <button type="button" className="send-action" onClick={() => sends.edit(send.message)}>
          Edit
        </button>
      )}
    </p>
  );
}

export function PendingSends({ sends }: { sends: ChatSends }) {
  return sends.pending.map((send) => (
    <div key={send.message.id} className="msg me" data-send={send.phase}>
      <MessageAttachments attachments={send.message.attachments} />
      {send.message.content && (
        <div className="bubble pending">
          <QuotedText text={send.message.content} />
        </div>
      )}
      <SendStatus send={send} sends={sends} />
    </div>
  ));
}
