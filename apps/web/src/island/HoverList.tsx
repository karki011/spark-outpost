import type { ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { Voice } from '../spark/voice.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { doneLine } from './crew-voice.ts';
import { sessionState, type Card, type CardKind, type SessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { elapsedText } from './island-parts.tsx';
import { plainLine } from './plain-line.ts';
import { SessionBlob } from './SessionBlob.tsx';
import { runStart, workLine, type WorkItem } from './work-items.ts';

export const STATUS_WORDS: Record<SessionState, string> = {
  working: 'running',
  waiting: 'needs you',
  done: 'done',
  failed: 'failed',
  idle: 'quiet',
};

const ASKS: Record<CardKind, string> = {
  approval: 'wants your go-ahead',
  force: 'wants to do something risky',
  question: 'asked you a question',
  open: 'is waiting for you',
};

export interface HoverGroups {
  needs: readonly Card[];
  running: readonly WorkItem[];
  recent: readonly ConversationSummary[];
}

export function hasHoverItems(groups: HoverGroups): boolean {
  return groups.needs.length + groups.running.length + groups.recent.length > 0;
}

export function recentLine(voice: Voice, chat: ConversationSummary): string {
  if (sessionState(chat) === 'failed') {
    return chat.latestRun?.error
      ? plainLine(chat.latestRun.error)
      : 'It stopped before the work was done.';
  }
  return doneLine(voice, 'all finished', chat.latestRun?.id ?? chat.id);
}

interface HoverListProps {
  groups: HoverGroups;
  voice: Voice;
  now: number;
  sleepy: boolean;
  onReview: (card: Card) => void;
  onOpen: (id: string) => void;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="isl-hsec" aria-label={label}>
      <h3 className="isl-hhead">{label}</h3>
      <ul className="isl-hlist">{children}</ul>
    </section>
  );
}

function Face({
  chat,
  state,
  sleepy,
}: {
  chat: ConversationSummary;
  state: SessionState;
  sleepy: boolean;
}) {
  return (
    <SessionBlob
      chat={chat}
      state={state}
      size={22}
      expression={sessionExpression(state, sleepy)}
    />
  );
}

export function HoverList({ groups, voice, now, sleepy, onReview, onOpen }: HoverListProps) {
  return (
    <div className="isl-body isl-hover">
      {groups.needs.length > 0 && (
        <Section label="Needs you">
          {groups.needs.map((card) => (
            <li key={card.approval?.id ?? card.chat.id} className="isl-hrow" data-state="waiting">
              <Face chat={card.chat} state="waiting" sleepy={false} />
              <span className="isl-hmain">
                <span className="isl-htitle">{card.chat.title}</span>
                <span className="isl-hsub">{ASKS[card.kind]}</span>
              </span>
              <span className="isl-hacts">
                <button type="button" className="isl-btn primary" onClick={() => onReview(card)}>
                  Review
                </button>
                <button type="button" className="isl-btn" onClick={() => onOpen(card.chat.id)}>
                  Open chat
                </button>
              </span>
            </li>
          ))}
        </Section>
      )}
      {groups.running.length > 0 && (
        <Section label="Running">
          {groups.running.map((item) => (
            <li key={item.chat.id}>
              <button
                type="button"
                className="isl-hrow"
                data-state="working"
                onClick={() => onOpen(item.chat.id)}
              >
                <Face chat={item.chat} state="working" sleepy={false} />
                <span className="isl-hmain">
                  <span className="isl-htitle">{item.chat.title}</span>
                  <span className="isl-hsub">{plainLine(workLine(voice, item))}</span>
                </span>
                <span className="isl-htime mono">{elapsedText(runStart(item), now)}</span>
              </button>
            </li>
          ))}
        </Section>
      )}
      {groups.recent.length > 0 && (
        <Section label="Recent">
          {groups.recent.map((chat) => {
            const state = sessionState(chat);
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  className="isl-hrow"
                  data-state={state}
                  onClick={() => onOpen(chat.id)}
                >
                  <Face chat={chat} state={state} sleepy={sleepy} />
                  <span className="isl-hmain">
                    <span className="isl-htitle">{chat.title}</span>
                    <span className="isl-hsub">{recentLine(voice, chat)}</span>
                  </span>
                  <span className="isl-htime">
                    <span className="isl-hstate">{STATUS_WORDS[state]}</span>
                    {relativeTime(chat.updatedAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </Section>
      )}
    </div>
  );
}
