import '../chat/thread.css';
import { useState, type ReactNode } from 'react';
import type { OutpostPost, ThreadItem } from '@spark-outpost/contracts';
import { useStickToBottom } from '../chat/use-stick-to-bottom.ts';
import { ArrowDownIcon } from '../ui/icons.tsx';
import { NotePost } from './NotePost.tsx';
import { NoticeLine } from './NoticeLine.tsx';
import { RequestPost } from './RequestPost.tsx';
import { announcements } from './post-announce.ts';

interface PostListProps {
  items: readonly ThreadItem[];
  answeringId: string | null;
  empty: ReactNode;
  onAnswer: (post: OutpostPost) => void;
  onCancel: (postId: string) => void;
  onOpenChat: (conversationId: string) => void;
}

interface Heard {
  items: readonly ThreadItem[];
  lines: readonly string[];
}

function useAnnouncements(items: readonly ThreadItem[]): readonly string[] {
  const [heard, setHeard] = useState<Heard>({ items, lines: [] });
  if (heard.items === items) return heard.lines;
  const fresh = announcements(heard.items, items);
  const lines = fresh.length > 0 ? fresh : heard.lines;
  setHeard({ items, lines });
  return lines;
}

export function PostList({
  items,
  answeringId,
  empty,
  onAnswer,
  onCancel,
  onOpenChat,
}: PostListProps) {
  const { scrollerRef, away, jumpToLatest } = useStickToBottom();
  const lines = useAnnouncements(items);
  return (
    <div className="thread-wrap">
      <div className="thread op-thread" ref={scrollerRef}>
        <div className="col">
          {items.length === 0 && empty}
          <ol className="op-posts" aria-label="Outpost thread">
            {items.map((item) => {
              if (item.kind === 'request') {
                return (
                  <RequestPost
                    key={item.post.id}
                    post={item.post}
                    answering={item.post.id === answeringId}
                    onAnswer={onAnswer}
                    onCancel={onCancel}
                    onOpenChat={onOpenChat}
                  />
                );
              }
              if (item.kind === 'note') return <NotePost key={item.post.id} post={item.post} />;
              if (item.kind === 'notice') return <NoticeLine key={item.post.id} post={item.post} />;
              return null;
            })}
          </ol>
        </div>
      </div>
      <div className="sr-only" role="log" aria-live="polite" aria-label="Outpost updates">
        {lines.map((line, index) => (
          <p key={`${index}:${line}`}>{line}</p>
        ))}
      </div>
      <button type="button" className={away ? 'jump show' : 'jump'} onClick={jumpToLatest}>
        <ArrowDownIcon />
        Jump to latest
      </button>
    </div>
  );
}
