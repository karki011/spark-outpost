import type { OutpostExchange } from '@spark-outpost/contracts';
import { MemberFace } from './MemberFace.tsx';
import { PostText } from './PostText.tsx';
import { splitQuestion } from './answer-text.ts';

interface AskedRoundProps {
  exchange: OutpostExchange;
  chatId: string | null;
  handle: string;
}

export function AskedRound({ exchange, chatId, handle }: AskedRoundProps) {
  const { said, asks } = splitQuestion(exchange.question);
  return (
    <div className="op-asked">
      <div className="op-post-head">
        {chatId && <MemberFace chatId={chatId} size="post" />}
        <b>{handle}</b>
        <span className="op-mood">asked</span>
      </div>
      {said && <PostText text={said} what="question" markdown />}
      {asks.map((ask, index) => (
        <p key={index} className="op-reason">
          {ask}
        </p>
      ))}
      <div className="op-post-head">
        <b>You</b>
        <span className="op-mood">answered</span>
      </div>
      <PostText text={exchange.answer} what="reply" />
    </div>
  );
}
