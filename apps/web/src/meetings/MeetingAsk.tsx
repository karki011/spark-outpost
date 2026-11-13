import './meeting-ask.css';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Approval, AssistantExchange, Meeting } from '@spark-outpost/contracts';
import { assistantApi, assistantKeys } from '../api/assistant.ts';
import { invalidateChatDetail } from '../api/chat-detail.ts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { assistantQuery, useAssistant } from '../island/ask-assistant.ts';
import { ArrowUpIcon, SparkleIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { askAboutMeeting, askPresets } from './meeting-ask.ts';

interface MeetingAskProps {
  meeting: Meeting;
  onOpenChat: ((id: string) => void) | undefined;
}

interface Asked {
  id: string;
  question: string;
}

const WAIT_POLL_MS = 1_500;
const QUESTION_MAX = 2_000;

function Answer({ text }: { text: string }) {
  const copy = useCopyFeedback();
  return (
    <div className="mt-ask-answer">
      <Markdown text={text} />
      <button type="button" className="btn ghost sm" onClick={() => copy.copy(text)}>
        {copyButtonText(copy.state)}
      </button>
    </div>
  );
}

function Exchange({
  asked,
  stored,
  cards,
  onReview,
}: {
  asked: Asked;
  stored: AssistantExchange | undefined;
  cards: readonly Approval[];
  onReview: (() => void) | null;
}) {
  return (
    <li className="mt-ask-exchange">
      <p className="mt-ask-question">{asked.question}</p>
      {stored?.answer ? (
        <Answer text={stored.answer} />
      ) : stored?.status === 'failed' ? (
        <p role="alert">Ask Spark couldn’t answer this.</p>
      ) : (
        <p className="mt-hint" role="status">
          Ask Spark is answering…
        </p>
      )}
      {cards.map((card) => (
        <div key={card.id} className="mt-ask-card" role="group" aria-label={card.title}>
          <p>{card.title}</p>
          {onReview && (
            <button type="button" className="btn line sm" onClick={onReview}>
              Review in Spark
            </button>
          )}
        </div>
      ))}
    </li>
  );
}

export function MeetingAsk({ meeting, onOpenChat }: MeetingAskProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const assistant = useAssistant();
  const thread = useRef<HTMLOListElement>(null);
  const [draft, setDraft] = useState('');
  const [asked, setAsked] = useState<Asked[]>([]);
  const historyKey = ['spark-assistant', 'history', 'meeting', meeting.id] as const;
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => assistantApi.history(null),
    enabled: asked.length > 0,
  });
  const [settled, setSettled] = useState<ReadonlyMap<string, AssistantExchange>>(new Map());
  const askedIds = new Set(asked.map((entry) => entry.id));
  const fresh = (history.data?.exchanges ?? []).filter(
    (exchange) =>
      askedIds.has(exchange.id) && exchange.status !== 'waiting' && !settled.has(exchange.id),
  );
  if (fresh.length > 0) {
    setSettled(new Map([...settled, ...fresh.map((exchange) => [exchange.id, exchange] as const)]));
  }
  const stored = new Map([
    ...(history.data?.exchanges ?? []).map((exchange) => [exchange.id, exchange] as const),
    ...settled,
  ]);
  const pendingCards = (assistant.detail?.approvals ?? []).filter(
    (card) => card.status === 'pending' && card.payload.sparkAction !== undefined,
  );
  const waiting =
    asked.some((entry) => stored.get(entry.id)?.status !== 'answered') || pendingCards.length > 0;
  const shown = asked.map((entry) => stored.get(entry.id)?.answer?.length ?? 0).join(',');

  useEffect(() => {
    const list = thread.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown, asked.length]);

  const assistantId = assistant.id;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['spark-assistant', 'history', 'meeting'] });
      if (assistantId) void invalidateChatDetail(queryClient, assistantId);
    }, WAIT_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, assistantId, queryClient]);

  const ask = useMutation({
    mutationFn: async ({ id, question }: Asked) => {
      const chatId = await queryClient.ensureQueryData(assistantQuery);
      await askAboutMeeting(chatId, id, question, meeting.id);
    },
    onSuccess: (_result, entry) => {
      setAsked((list) => [...list, entry]);
      void queryClient.invalidateQueries({ queryKey: assistantKeys.history });
    },
  });

  function send(question: string, clear: boolean) {
    const text = question.trim();
    if (!text || ask.isPending) return;
    ask.mutate(
      { id: crypto.randomUUID(), question: text },
      { onSuccess: () => clear && setDraft('') },
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(draft, true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send(draft, true);
  }

  const review = assistantId && onOpenChat ? () => onOpenChat(assistantId) : null;

  return (
    <section className="mt-ask" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className="mt-ask-title">
        <SparkleIcon />
        Ask about this meeting
      </h3>
      {asked.length > 0 && (
        <ol ref={thread} className="mt-ask-thread" aria-label="Questions about this meeting">
          {asked.map((entry) => {
            const exchange = stored.get(entry.id);
            const cards = exchange?.runId
              ? pendingCards.filter((card) => card.runId === exchange.runId)
              : [];
            return (
              <Exchange
                key={entry.id}
                asked={entry}
                stored={exchange}
                cards={cards}
                onReview={review}
              />
            );
          })}
        </ol>
      )}
      <div className="mt-ask-presets" role="group" aria-label="Quick questions">
        {askPresets(meeting.state === 'recording').map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn line sm"
            disabled={ask.isPending}
            onClick={() => send(preset.question, false)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <form className="mt-ask-form" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor={`${ids}-box`}>
          Ask Spark about this meeting
        </label>
        <textarea
          id={`${ids}-box`}
          className="inp mt-ask-box"
          rows={1}
          maxLength={QUESTION_MAX}
          placeholder="Ask about this meeting"
          aria-describedby={`${ids}-note`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className="btn primary sm"
          aria-label="Send question"
          disabled={!draft.trim() || ask.isPending}
        >
          <ArrowUpIcon />
        </button>
      </form>
      <p id={`${ids}-note`} className="mt-ask-note">
        Sends your question and this meeting’s transcript, notes and goal to Ask Spark as untrusted
        text. Anything it wants to do is a card.
      </p>
      {ask.isError && <p role="alert">Couldn’t ask. {ask.error.message}</p>}
    </section>
  );
}
