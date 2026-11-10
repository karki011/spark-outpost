import type { MouseEvent } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { RowAction } from './HomeCards.tsx';
import { rowAnswer } from './row-answer.ts';
import { useHomeAnswers, type AnswerSide } from './use-answer-card.tsx';

const COMPOSER_INPUT = '.home-compose textarea, .home-compose [role="textbox"]';

function focusAfter(row: Element | null) {
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
  const next =
    neighbour?.querySelector<HTMLElement>('.hrow-a button') ??
    row?.closest('main')?.querySelector<HTMLElement>(COMPOSER_INPUT);
  next?.focus();
}

interface RowButtonsProps {
  chat: ConversationSummary;
  label: string;
  primary?: boolean;
  onOpen: () => void;
}

export function RowButtons({ chat, label, primary, onOpen }: RowButtonsProps) {
  const { answer } = useHomeAnswers();
  const open = (
    <RowAction
      label={label}
      name={`${label}: ${chat.title}`}
      primary={primary === true && !rowAnswer(chat)}
      onClick={onOpen}
    />
  );
  if (!rowAnswer(chat)) return open;
  const respond = (side: AnswerSide) => (event: MouseEvent<HTMLButtonElement>) => {
    const row = event.currentTarget.closest('li');
    answer(chat, side);
    focusAfter(row);
  };
  return (
    <>
      <button
        type="button"
        className="btn sm primary"
        aria-label={`Allow once: ${chat.title}`}
        onClick={respond('allow')}
      >
        Allow
      </button>
      <button
        type="button"
        className="btn sm line"
        aria-label={`Deny: ${chat.title}`}
        onClick={respond('deny')}
      >
        Deny
      </button>
      {open}
    </>
  );
}

export function RowError({ chatId }: { chatId: string }) {
  const message = useHomeAnswers().errorOf(chatId);
  if (!message) return null;
  return (
    <span className="hrow-err" role="alert">
      Could not answer: {message}
    </span>
  );
}
