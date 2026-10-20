import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Approval, CalendarEvent, ConversationDetail } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { assistantApi, assistantKeys } from '../api/assistant.ts';
import type { Voice } from '../spark/voice.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { fastAnswer, type FastState } from './ask-fast-path.ts';
import { askRows, lastExchange, type PendingAsk } from './ask-history-model.ts';
import { meetingAnswer, NEXT_MEETING_QUESTION } from './ask-meeting.ts';
import { AskLog, type AskLinks } from './AskLog.tsx';
import { islandApi, islandKeys } from './island-api.ts';
import { queueApi } from '../chat/queue/queue-api.ts';
import { plainLine } from './plain-line.ts';
import type { AskSession } from './use-ask-session.ts';
import { MicButton } from '../voice/MicButton.tsx';
import { useSeed, useSpeechSeeds } from '../voice/speech-seed.tsx';
import { joinDictation } from '../voice/use-dictation.ts';

interface AskSparkProps {
  fast: FastState;
  voice: Voice;
  focusDelay: number;
  session: AskSession;
  meetings: readonly CalendarEvent[] | null;
  links: AskLinks;
}

const CHEER_MS = 1_400;
const ASKED_CHIPS = ['Who needs me?', 'What’s running?'];

const assistantQuery = queryOptions({
  queryKey: islandKeys.assistant,
  queryFn: islandApi.assistant,
  staleTime: Infinity,
});

function useAssistant() {
  const id = useQuery(assistantQuery);
  const detail = useQuery({
    queryKey: queryKeys.conversation(id.data ?? 'none'),
    queryFn: () => api.getConversation(id.data!),
    enabled: id.data !== undefined,
  });
  return { id: id.data ?? null, error: id.error, detail: detail.data };
}

function useHistory() {
  return useInfiniteQuery({
    queryKey: assistantKeys.history,
    queryFn: ({ pageParam }) => assistantApi.history(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.older,
  });
}

interface PendingQuestion {
  id: string;
  question: string;
  spoken: boolean;
}

function assistantCards(detail: ConversationDetail | undefined) {
  const byRun = new Map<string, Approval[]>();
  for (const approval of detail?.approvals ?? []) {
    if (!approval.payload.sparkAction) continue;
    byRun.set(approval.runId, [...(byRun.get(approval.runId) ?? []), approval]);
  }
  return byRun;
}

function useCheer(thinking: boolean, latest: string | null): string | null {
  const [cheer, setCheer] = useState<string | null>(null);
  const was = useRef(thinking);
  useEffect(() => {
    const finished = was.current && !thinking;
    was.current = thinking;
    if (!finished || !latest) return;
    const start = setTimeout(() => setCheer(latest), 0);
    const stop = setTimeout(() => setCheer(null), CHEER_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [thinking, latest]);
  return cheer;
}

export function AskSpark({ fast, voice, focusDelay, session, meetings, links }: AskSparkProps) {
  const queryClient = useQueryClient();
  const assistant = useAssistant();
  const history = useHistory();
  const now = useMinuteClock();
  const [text, setText] = useState('');
  const [asks, setAsks] = useState<PendingAsk[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const secrets = useSecretGuard(text);
  const detail = assistant.detail;
  const run = detail?.conversation.latestRun;
  const thinking = run?.status === 'queued' || run?.status === 'running';

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), focusDelay);
    return () => clearTimeout(timer);
  }, [focusDelay]);

  useEffect(() => {
    const conversation = detail?.conversation;
    if (conversation?.unread && !thinking)
      void api.markConversationSeen(conversation.id).catch(() => null);
  }, [detail, thinking]);

  const answered = `${run?.id}:${run?.status}:${detail?.messages.length}`;
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.history });
  }, [answered, queryClient]);

  const ask = useMutation({
    mutationFn: async ({ id, question, spoken }: PendingQuestion) => {
      setAsks((list) => [...list, { id, question, at: Date.now() }]);
      const assistantId = await queryClient.ensureQueryData(assistantQuery);
      await queueApi.add(assistantId, id, question, spoken ? 'voice' : undefined);
      return assistantId;
    },
    onError: (_error, { id }) => setAsks((list) => list.filter((entry) => entry.id !== id)),
    onSuccess: (assistantId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(assistantId) });
    },
  });

  const newTopic = useMutation({
    mutationFn: assistantApi.newTopic,
    onSuccess: (view) => {
      queryClient.setQueryData(assistantKeys.settings, view);
      void queryClient.invalidateQueries({ queryKey: assistantKeys.history });
      if (view.conversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(view.conversationId),
        });
      }
      inputRef.current?.focus({ preventScroll: true });
    },
  });

  const instantly = (question: string): boolean => {
    const answer = fastAnswer(question, fast);
    if (answer) {
      session.add(question, answer.text, answer.chats);
      return true;
    }
    const meeting = meetingAnswer(question, meetings, Date.now());
    if (meeting) session.add(question, meeting, []);
    return meeting !== null;
  };

  const send = (question: string, spoken = false) => {
    if (instantly(question)) return;
    ask.mutate({ id: crypto.randomUUID(), question, spoken });
  };

  const submit = () => {
    const question = text.trim();
    if (!question || secrets.blocks(text)) return;
    setText('');
    const spoken = heard.current === question;
    heard.current = null;
    send(question, spoken);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const { speak } = useSpeechSeeds();
  const spokenQuestion = useRef<string | null>(null);
  const heard = useRef<string | null>(null);
  const seed = useSeed(
    'ask',
    (next) => {
      if (next.answer) {
        session.add(next.question, next.answer.text, next.answer.chats);
        return;
      }
      heard.current = next.question.trim();
      setText(next.question);
      inputRef.current?.focus({ preventScroll: true });
    },
    () => {
      spokenQuestion.current = text.trim();
      submit();
    },
  );

  const pages = history.data?.pages;
  const stored = new Set(pages?.flatMap((page) => page.exchanges.map((entry) => entry.id)));
  if (asks.some((entry) => stored.has(entry.id))) {
    setAsks(asks.filter((entry) => !stored.has(entry.id)));
  }
  const rows = askRows(pages ?? [], session.answers, asks, now);
  const latest = lastExchange(rows);
  useEffect(() => {
    if (!latest?.answer || latest.live || !spokenQuestion.current) return;
    if (latest.question.trim() !== spokenQuestion.current) return;
    spokenQuestion.current = null;
    speak(plainLine(latest.answer));
  }, [latest, speak]);
  const cheer = useCheer(thinking, latest?.answer ? latest.key : null);
  const step = run?.step ? plainLine(run.step) : null;
  const cards = assistantCards(detail);
  const busy = thinking || ask.isPending || latest?.status === 'waiting';
  const chips = meetings ? [...ASKED_CHIPS, NEXT_MEETING_QUESTION] : ASKED_CHIPS;
  const error = ask.error ?? newTopic.error ?? assistant.error ?? history.error;
  return (
    <div className="isl-panel">
      <div className="isl-ask-head">
        <span className="isl-sp" />
        <button
          type="button"
          className="isl-btn"
          disabled={busy || newTopic.isPending}
          title={busy ? 'Wait for Ask Spark to finish answering first' : undefined}
          onClick={() => newTopic.mutate()}
        >
          New topic
        </button>
        <button
          type="button"
          className="isl-btn"
          disabled={!assistant.id}
          onClick={() => assistant.id && links.onOpenChat(assistant.id)}
        >
          Open in Spark <ExternalLinkIcon />
        </button>
      </div>
      <AskLog
        rows={rows}
        pages={pages?.length ?? 0}
        older={{
          more: history.hasNextPage,
          loading: history.isFetchingNextPage,
          load: () => void history.fetchNextPage(),
        }}
        voice={voice}
        step={step}
        cheer={cheer}
        links={links}
        cards={{ conversationId: assistant.id, byRun: cards }}
      />
      <div className="isl-ask-chips" role="group" aria-label="Suggested questions">
        {chips.map((chip) => (
          <button key={chip} type="button" className="isl-chip" onClick={() => send(chip)}>
            {chip}
          </button>
        ))}
      </div>
      <div className="isl-qc">
        <SecretWarning guard={secrets} input={inputRef} onText={setText} onSendAnyway={submit} />
        <label className="sr-only" htmlFor="isl-ask-text">
          Ask Spark
        </label>
        <textarea
          id="isl-ask-text"
          ref={inputRef}
          rows={1}
          placeholder="Ask about your chats, tickets, spend, calendar…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="isl-qc-bar">
          <span className="isl-qc-hint">
            {seed && !seed.answer && text.trim() === seed.question
              ? 'Enter to ask, or press the Voice shortcut and say “send”'
              : 'Answers use the Spark assistant model'}
          </span>
          <span className="isl-sp" />
          <MicButton
            className="isl-chip"
            onText={(heard) => setText((now) => joinDictation(now, heard))}
          />
          <button
            type="button"
            className="isl-send"
            aria-label="Ask"
            disabled={!text.trim()}
            onClick={submit}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>
      </div>
      {error && (
        <p className="isl-err" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
