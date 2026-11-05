import { useCallback, useMemo, useState } from 'react';
import type { AssistantChatLink } from '@spark-outpost/contracts';
import type { AnswerChat } from '../voice/answers.ts';
import type { LocalAnswer } from './ask-history-model.ts';

export interface AskSession {
  answers: readonly LocalAnswer[];
  add: (question: string, answer: string, chats: readonly AnswerChat[]) => void;
}

function linksOf(chats: readonly AnswerChat[]): AssistantChatLink[] {
  return chats.slice(0, 3).map((chat) => ({ conversationId: chat.id, title: chat.title }));
}

export function useAskSession(): AskSession {
  const [answers, setAnswers] = useState<LocalAnswer[]>([]);
  const add = useCallback((question: string, answer: string, chats: readonly AnswerChat[]) => {
    setAnswers((list) => [
      ...list,
      { id: crypto.randomUUID(), question, answer, links: linksOf(chats), at: Date.now() },
    ]);
  }, []);
  return useMemo(() => ({ answers, add }), [answers, add]);
}
