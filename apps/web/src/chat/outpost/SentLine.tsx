import './outpost-chat.css';
import type { OutpostPost } from '@spark-outpost/contracts';
import { STATE_LABELS } from '../../outposts/post-text.ts';
import { ChevronIcon, OutpostIcon } from '../../ui/icons.tsx';
import { firstLine } from './chat-lines.ts';

interface SentLineProps {
  post: Pick<OutpostPost, 'body' | 'toHandle' | 'state'>;
  onOpen?: (() => void) | undefined;
}

export function SentLine({ post, onOpen }: SentLineProps) {
  const receiver = post.toHandle ? `@${post.toHandle}` : 'a removed chat';
  return (
    <p className="ai-note op-line">
      <OutpostIcon />
      <span className="op-line-lead">To {receiver}</span>
      <span className="op-line-text">{firstLine(post.body)}</span>
      {post.state && (
        <span className={`op-line-state ${post.state}`}>{STATE_LABELS[post.state]}</span>
      )}
      {onOpen && (
        <button
          type="button"
          className="from-open"
          aria-label={`Open the request to ${receiver} in the outpost`}
          onClick={onOpen}
        >
          Open in outpost
          <ChevronIcon />
        </button>
      )}
    </p>
  );
}
