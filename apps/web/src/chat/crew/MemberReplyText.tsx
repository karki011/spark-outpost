import { memberReply, piecesNoticeText } from '../../crew/member-reply.ts';
import { Markdown } from '../markdown/Markdown.tsx';

interface MemberReplyTextProps {
  role: string | null;
  text: string;
  streaming?: boolean;
}

export function MemberReplyText({ role, text, streaming = false }: MemberReplyTextProps) {
  const reply = memberReply(role, text, streaming);
  return (
    <>
      {reply.before && <Markdown text={reply.before} streaming={streaming && !reply.notice} />}
      {reply.notice && (
        <p className="ai-note" role="status" data-pieces={reply.notice.state}>
          {piecesNoticeText(reply.notice)}
        </p>
      )}
      {reply.after && <Markdown text={reply.after} streaming={streaming} />}
    </>
  );
}
