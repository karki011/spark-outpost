import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  approvalAttentionKey,
  type AttentionList,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { approvalsApi } from '../api/approvals.ts';
import { attentionKey } from '../attention/attention-api.ts';
import { answeredChat, rowAnswer } from './row-answer.ts';

export type AnswerSide = 'allow' | 'deny';

export interface HomeAnswers {
  answer: (chat: ConversationSummary, side: AnswerSide) => void;
  errorOf: (chatId: string) => string | undefined;
}

const NO_ANSWERS: HomeAnswers = { answer: () => undefined, errorOf: () => undefined };

const HomeAnswersContext = createContext<HomeAnswers>(NO_ANSWERS);

export function useHomeAnswers(): HomeAnswers {
  return useContext(HomeAnswersContext);
}

interface Snapshot {
  chats: ConversationSummary[] | undefined;
  attention: AttentionList | undefined;
}

function withoutKey(errors: ReadonlyMap<string, string>, chatId: string) {
  const next = new Map(errors);
  next.delete(chatId);
  return next;
}

export function HomeAnswersProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const mutation = useMutation({
    mutationFn: ({ chat, side }: { chat: ConversationSummary; side: AnswerSide }) => {
      const target = rowAnswer(chat);
      if (!target) throw new Error('This card needs you in the chat.');
      return approvalsApi.decide(target.approvalId, {
        optionId: side === 'allow' ? target.allow : target.deny,
        scope: 'once',
        payloadHash: target.payloadHash,
      });
    },
    onMutate: async ({ chat }): Promise<Snapshot> => {
      setErrors((current) => withoutKey(current, chat.id));
      await Promise.all([
        client.cancelQueries({ queryKey: queryKeys.conversations }),
        client.cancelQueries({ queryKey: attentionKey }),
      ]);
      const snapshot: Snapshot = {
        chats: client.getQueryData<ConversationSummary[]>(queryKeys.conversations),
        attention: client.getQueryData<AttentionList>(attentionKey),
      };
      const approvalId = chat.attention?.approvalId;
      client.setQueryData<ConversationSummary[]>(queryKeys.conversations, (chats) =>
        chats?.map((entry) => (entry.id === chat.id ? answeredChat(entry) : entry)),
      );
      client.setQueryData<AttentionList>(attentionKey, (list) =>
        list && approvalId
          ? { items: list.items.filter((item) => item.key !== approvalAttentionKey(approvalId)) }
          : list,
      );
      return snapshot;
    },
    onError: (error, { chat }, snapshot) => {
      if (snapshot?.chats) client.setQueryData(queryKeys.conversations, snapshot.chats);
      if (snapshot?.attention) client.setQueryData(attentionKey, snapshot.attention);
      const message = error instanceof Error ? error.message : 'Could not send the answer.';
      setErrors((current) => new Map(current).set(chat.id, message));
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.conversations }),
        client.invalidateQueries({ queryKey: attentionKey }),
      ]),
  });
  const { mutate } = mutation;
  const value = useMemo<HomeAnswers>(
    () => ({
      answer: (chat, side) => mutate({ chat, side }),
      errorOf: (chatId) => errors.get(chatId),
    }),
    [mutate, errors],
  );
  return <HomeAnswersContext.Provider value={value}>{children}</HomeAnswersContext.Provider>;
}
