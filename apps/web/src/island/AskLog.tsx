import { useLayoutEffect, useRef } from 'react';
import type { AssistantChatLink } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { TopicDivider } from '../chat/compaction/DividerLine.tsx';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import type { Voice } from '../spark/voice.ts';
import type { AskRow, ExchangeRow } from './ask-history-model.ts';
import { AskThinking } from './AskThinking.tsx';

const NEAR_TOP_PX = 24;

export interface AskLinks {
  reviewable: ReadonlySet<string>;
  onReview: (chatId: string) => void;
  onOpenChat: (chatId: string) => void;
}

interface AskLogProps {
  rows: readonly AskRow[];
  pages: number;
  older: { more: boolean; loading: boolean; load: () => void };
  voice: Voice;
  step: string | null;
  cheer: string | null;
  links: AskLinks;
}

function ChatLinks({ chats, links }: { chats: readonly AssistantChatLink[]; links: AskLinks }) {
  if (chats.length === 0) return null;
  return (
    <div className="isl-acts">
      {chats.map((chat) =>
        links.reviewable.has(chat.conversationId) ? (
          <button
            key={chat.conversationId}
            type="button"
            className="isl-btn primary"
            onClick={() => links.onReview(chat.conversationId)}
          >
            Review “{chat.title}”
          </button>
        ) : (
          <button
            key={chat.conversationId}
            type="button"
            className="isl-btn"
            onClick={() => links.onOpenChat(chat.conversationId)}
          >
            Open “{chat.title}”
          </button>
        ),
      )}
    </div>
  );
}

function SourceLine({ row, links }: { row: ExchangeRow; links: AskLinks }) {
  if (row.live) return <small className="isl-ask-src">Live · answered instantly</small>;
  const source = row.source;
  if (!source) return null;
  return (
    <small className="isl-ask-src">
      From: chat{' '}
      <button
        type="button"
        className="isl-ask-srclink"
        onClick={() => links.onOpenChat(source.conversationId)}
      >
        “{source.title}”
      </button>
    </small>
  );
}

function Answer({ row, cheer, links }: { row: ExchangeRow; cheer: boolean; links: AskLinks }) {
  const others = row.links.filter((chat) => chat.conversationId !== row.source?.conversationId);
  return (
    <div className="isl-ask-a">
      <span className="isl-ask-scout" aria-hidden="true">
        <BlobScout size={16} mood={cheer ? 'happy' : null} />
      </span>
      <div className="isl-ask-md">
        {row.live ? <p>{row.answer}</p> : <Markdown text={row.answer ?? ''} />}
        <ChatLinks chats={others} links={links} />
        <SourceLine row={row} links={links} />
      </div>
    </div>
  );
}

function Exchange({ row, last, props }: { row: ExchangeRow; last: boolean; props: AskLogProps }) {
  return (
    <div className="isl-ask-pair">
      <p className="isl-ask-q">{row.question}</p>
      {row.status === 'answered' && (
        <Answer row={row} cheer={props.cheer === row.key} links={props.links} />
      )}
      {row.status === 'failed' && <p className="isl-ask-note">Spark couldn’t answer this one.</p>}
      {row.status === 'waiting' &&
        (last ? (
          <AskThinking voice={props.voice} step={props.step} />
        ) : (
          <p className="isl-ask-note">Waiting to be answered…</p>
        ))}
    </div>
  );
}

export function AskLog(props: AskLogProps) {
  const { rows, pages, older } = props;
  const ref = useRef<HTMLDivElement>(null);
  const fromBottom = useRef<number | null>(null);
  const tail = rows.at(-1);
  const tailKey = tail ? `${tail.key}:${tail.kind === 'exchange' ? tail.status : ''}` : '';
  const lastExchangeKey = rows.findLast((row) => row.kind === 'exchange')?.key;

  useLayoutEffect(() => {
    const log = ref.current;
    if (!log || fromBottom.current === null) return;
    log.scrollTop = log.scrollHeight - fromBottom.current;
    fromBottom.current = null;
  }, [pages]);

  useLayoutEffect(() => {
    const log = ref.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [tailKey]);

  const loadOlder = () => {
    const log = ref.current;
    if (!log || !older.more || older.loading) return;
    fromBottom.current = log.scrollHeight - log.scrollTop;
    older.load();
  };

  return (
    <div
      ref={ref}
      className="isl-ask-log"
      aria-live="polite"
      onScroll={(event) => {
        if (event.currentTarget.scrollTop < NEAR_TOP_PX) loadOlder();
      }}
    >
      {older.more && (
        <button
          type="button"
          className="isl-btn link isl-ask-older"
          disabled={older.loading}
          aria-busy={older.loading}
          onClick={loadOlder}
        >
          Earlier questions
        </button>
      )}
      {rows.length === 0 && (
        <p className="isl-hint">
          Ask about your chats: who needs you, what’s running, what you spent today.
        </p>
      )}
      {rows.map((row) => {
        if (row.kind === 'day') {
          return (
            <p key={row.key} className="isl-ask-day">
              {row.label}
            </p>
          );
        }
        if (row.kind === 'topic') return <TopicDivider key={row.key} label={row.label} />;
        return (
          <Exchange key={row.key} row={row} last={row.key === lastExchangeKey} props={props} />
        );
      })}
    </div>
  );
}
