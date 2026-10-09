import './today.css';
import { useId, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { TodayChat } from '@spark-outpost/contracts';
import { chatBlob } from '../../brand/ChatFace.tsx';
import { homeApi, homeKeys } from '../../home/home-api.ts';
import { quietToday, type Voice } from '../../spark/voice.ts';
import { chatExpression, chatNote, todayStats } from './today-model.ts';

const SKELETON_ROWS = [62, 48, 55];
const SKELETON_STATS = [52, 84, 44];

function TodaySkeleton() {
  return (
    <div className="today-sk" aria-hidden="true">
      <div className="today-stats">
        {SKELETON_STATS.map((width) => (
          <span key={width} className="today-shim pill" style={{ width }} />
        ))}
      </div>
      <ul className="today-chats">
        {SKELETON_ROWS.map((width) => (
          <li key={width} className="today-row">
            <span className="today-shim dot" />
            <span className="today-shim" style={{ width: `${width}%` }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatRow({
  chat,
  index,
  onOpen,
}: {
  chat: TodayChat;
  index: number;
  onOpen: (id: string) => void;
}) {
  return (
    <li style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className="today-row"
        title={chat.title}
        onClick={() => onOpen(chat.id)}
      >
        <span className="today-blob" aria-hidden="true">
          <Blobatar
            {...chatBlob(chat.id)}
            size={20}
            animate="hover"
            expression={expressions[chatExpression(chat.state)]}
            aria-hidden="true"
          />
        </span>
        <span className="t">{chat.title}</span>
        <span className="k">{chatNote(chat)}</span>
      </button>
    </li>
  );
}

export function TodaySoFar({
  voice,
  onOpenChat,
}: {
  voice: Voice;
  onOpenChat: (id: string) => void;
}) {
  const headingId = useId();
  const today = useQuery({ queryKey: homeKeys.today, queryFn: homeApi.today });
  if (today.isError) return null;
  const summary = today.data;
  return (
    <section className="today" aria-labelledby={headingId} aria-busy={today.isPending}>
      <h3 id={headingId}>Today so far</h3>
      {!summary ? (
        <TodaySkeleton />
      ) : summary.chats === 0 ? (
        <p className="today-quiet">{quietToday(voice)}</p>
      ) : (
        <>
          <ul className="today-stats" aria-label="Today in numbers">
            {todayStats(summary).map((stat) => (
              <li key={stat.key} data-attention={stat.attention || undefined}>
                <b>{stat.count}</b> {stat.label}
              </li>
            ))}
          </ul>
          <ul className="today-chats" aria-label="Chats from today">
            {summary.recent.map((chat, index) => (
              <ChatRow key={chat.id} chat={chat} index={index} onOpen={onOpenChat} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
