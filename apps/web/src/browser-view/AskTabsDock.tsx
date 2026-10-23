import './ask-tabs-dock.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Approval, AssistantExchange } from '@spark-outpost/contracts';
import { assistantApi, assistantKeys } from '../api/assistant.ts';
import { queryKeys } from '../api/client.ts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { assistantQuery, useAssistant } from '../island/ask-assistant.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { EyeIcon, SparkleIcon, WarnIcon } from '../ui/icons.tsx';
import { askAboutTabs } from './ask-tabs.ts';
import { MentionComposer } from './MentionComposer.tsx';
import type { PageRef } from './page-chat.ts';
import { acceptViewState, useProfileTabs } from './view-store.ts';

interface AskTabsDockProps {
  first: PageRef | null;
  onOpenAssistant(chatId: string): void;
  onClose(): void;
}

interface Asked {
  id: string;
  question: string;
  tabs: number;
}

const WAIT_POLL_MS = 1_500;
const NEAR_BOTTOM_PX = 48;
const DOCK_HISTORY = ['spark-assistant', 'history', 'browser-view'] as const;

function useOpenTabs() {
  useEffect(() => {
    const view = desktopBrowserView();
    for (const profile of ['personal', 'work'] as const) {
      void view
        ?.start(profile)
        .then(acceptViewState)
        .catch(() => undefined);
    }
  }, []);
  const personal = useProfileTabs('personal').tabs;
  const work = useProfileTabs('work').tabs;
  return new Map([
    ['personal', personal],
    ['work', work],
  ] as const);
}

function useFollowLatest(content: string, sent: number) {
  const thread = useRef<HTMLOListElement>(null);
  const near = useRef(true);
  const lastSent = useRef(sent);
  useEffect(() => {
    const list = thread.current;
    if (!list) return;
    const justSent = lastSent.current !== sent;
    lastSent.current = sent;
    if (justSent || near.current) list.scrollTop = list.scrollHeight;
  }, [content, sent]);
  const onScroll = () => {
    const list = thread.current;
    if (list)
      near.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  };
  return { thread, onScroll };
}

function readLine(tabs: number): string {
  if (tabs === 0) return 'No tabs read · sent as an ordinary question';
  return `Read ${tabs === 1 ? '1 tab' : `${tabs} tabs`} you mentioned · text only · sent with your question`;
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
  onReview(): void;
}) {
  return (
    <li className="atd-exchange">
      <p className="atd-question">{asked.question}</p>
      <p className="atd-read">
        <EyeIcon />
        {readLine(asked.tabs)}
      </p>
      {stored?.answer ? (
        <div className="atd-answer">
          <Markdown text={stored.answer} />
        </div>
      ) : stored?.status === 'failed' ? (
        <p className="pcd-problem">Ask Spark couldn’t answer this.</p>
      ) : (
        <p className="atd-wait" role="status">
          Ask Spark is answering…
        </p>
      )}
      {cards.map((card) => (
        <div key={card.id} className="atd-card" role="group" aria-label={card.title}>
          <p>{card.title}</p>
          <button type="button" className="btn" onClick={onReview}>
            Review in Spark
          </button>
        </div>
      ))}
    </li>
  );
}

export function AskTabsDock({ first, onOpenAssistant, onClose }: AskTabsDockProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const input = useRef<HTMLTextAreaElement>(null);
  const open = useOpenTabs();
  const assistant = useAssistant();
  const settings = useQuery({ queryKey: assistantKeys.settings, queryFn: assistantApi.settings });
  const [mentions, setMentions] = useState<PageRef[]>(first ? [first] : []);
  const [asked, setAsked] = useState<Asked[]>([]);
  const history = useQuery({
    queryKey: DOCK_HISTORY,
    queryFn: () => assistantApi.history(null),
    enabled: asked.length > 0,
  });
  const stored = new Map(history.data?.exchanges.map((exchange) => [exchange.id, exchange]));
  const pendingCards = (assistant.detail?.approvals ?? []).filter(
    (card) => card.status === 'pending' && card.payload.sparkAction !== undefined,
  );
  const shown = asked
    .map((entry) => `${entry.id}:${stored.get(entry.id)?.answer?.length ?? 0}`)
    .join(',');
  const { thread, onScroll } = useFollowLatest(`${shown}:${pendingCards.length}`, asked.length);
  const waiting =
    asked.some((entry) => stored.get(entry.id)?.status !== 'answered') || pendingCards.length > 0;

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: DOCK_HISTORY });
      if (assistant.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(assistant.id) });
      }
    }, WAIT_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, assistant.id, queryClient]);

  const ask = useMutation({
    mutationFn: async ({
      id,
      question,
      tabs,
    }: {
      id: string;
      question: string;
      tabs: PageRef[];
    }) => {
      const assistantId = await queryClient.ensureQueryData(assistantQuery);
      await askAboutTabs(assistantId, id, question, tabs);
    },
    onSuccess: (_result, { id, question, tabs }) => {
      setAsked((list) => [...list, { id, question, tabs: tabs.length }]);
      setMentions([]);
      void queryClient.invalidateQueries({ queryKey: DOCK_HISTORY });
      void queryClient.invalidateQueries({ queryKey: assistantKeys.history });
    },
  });

  const review = () => assistant.id && onOpenAssistant(assistant.id);
  const acts = settings.data?.settings.acts === 'act' ? 'Act' : 'Manual';

  return (
    <aside
      className="pcd atd"
      aria-labelledby={`${ids}-title`}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="pcd-head">
        <SparkleIcon />
        <h2 id={`${ids}-title`}>Ask Spark</h2>
        <span className="pcd-badge" title="When Ask Spark acts, in Settings → Spark assistant">
          {acts}
        </span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {asked.length === 0 ? (
        <p className="pcd-note">
          <EyeIcon />
          Spark reads the tabs you @-mention once, when you send, as text marked untrusted. It never
          opens, rereads or acts in them.
        </p>
      ) : (
        <ol
          ref={thread}
          className="atd-thread"
          aria-label="Questions about your tabs"
          onScroll={onScroll}
        >
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
      {asked.some((entry) => entry.tabs > 0) && (
        <p className="atd-guard">
          <WarnIcon />
          <span>
            <b>Page text read.</b> Pages are untrusted. Anything this question asks Spark to do is a
            card, even when Ask Spark acts on its own, and it answers no other chat’s card.
          </span>
        </p>
      )}
      <MentionComposer
        input={input}
        open={open}
        mentions={mentions}
        onMentions={setMentions}
        busy={ask.isPending}
        onSend={(question) =>
          ask.mutateAsync({ id: crypto.randomUUID(), question, tabs: [...mentions] })
        }
        onClose={onClose}
      />
      {ask.error && (
        <p className="pcd-problem" role="alert">
          {ask.error.message}
        </p>
      )}
    </aside>
  );
}
