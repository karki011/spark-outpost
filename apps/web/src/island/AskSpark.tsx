import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import type { Voice } from '../spark/voice.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { fastAnswer, type FastChat, type FastState } from './ask-fast-path.ts';
import { AskThinking } from './AskThinking.tsx';
import { islandApi, islandKeys } from './island-api.ts';
import { plainLine } from './plain-line.ts';

interface Exchange {
  id: string;
  question: string;
  answer: string | null;
  chats: FastChat[];
  instant: boolean;
}

interface AskSparkProps {
  fast: FastState;
  voice: Voice;
  focusDelay: number;
  onOpenChat: (id: string) => void;
}

const HISTORY = 3;
const CHEER_MS = 1_400;

function useAssistant() {
  const id = useQuery({
    queryKey: islandKeys.assistant,
    queryFn: islandApi.assistant,
    staleTime: Infinity,
  });
  const detail = useQuery({
    queryKey: queryKeys.conversation(id.data ?? 'none'),
    queryFn: () => api.getConversation(id.data!),
    enabled: id.data !== undefined,
  });
  return { id: id.data ?? null, error: id.error, detail: detail.data };
}

function modelExchanges(detail: ReturnType<typeof useAssistant>['detail']): Exchange[] {
  if (!detail) return [];
  const exchanges: Exchange[] = [];
  for (const message of detail.messages) {
    if (message.role === 'user') {
      exchanges.push({
        id: message.id,
        question: message.content,
        answer: null,
        chats: [],
        instant: false,
      });
    } else if (exchanges.length > 0) {
      exchanges.at(-1)!.answer = message.content.trim();
    }
  }
  return exchanges;
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

export function AskSpark({ fast, voice, focusDelay, onOpenChat }: AskSparkProps) {
  const queryClient = useQueryClient();
  const assistant = useAssistant();
  const [text, setText] = useState('');
  const [instant, setInstant] = useState<Exchange[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const secrets = useSecretGuard(text);
  const run = assistant.detail?.conversation.latestRun;
  const thinking = run?.status === 'queued' || run?.status === 'running';

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), focusDelay);
    return () => clearTimeout(timer);
  }, [focusDelay]);

  useEffect(() => {
    const conversation = assistant.detail?.conversation;
    if (conversation?.unread && !thinking)
      void api.markConversationRead(conversation.id).catch(() => null);
  }, [assistant.detail, thinking]);

  const ask = useMutation({
    mutationFn: async (question: string) => {
      if (!assistant.id) throw new Error('Spark isn’t ready to answer yet.');
      await api.sendMessage(assistant.id, crypto.randomUUID(), question);
    },
    onSuccess: () => {
      if (assistant.id)
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(assistant.id) });
    },
  });

  const submit = () => {
    const question = text.trim();
    if (!question || ask.isPending || thinking || secrets.blocks(text)) return;
    setText('');
    const answer = fastAnswer(question, fast);
    if (answer) {
      setInstant((list) => [
        ...list,
        {
          id: crypto.randomUUID(),
          question,
          answer: answer.text,
          chats: answer.chats,
          instant: true,
        },
      ]);
      return;
    }
    ask.mutate(question);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const shown = [...modelExchanges(assistant.detail), ...instant].slice(-HISTORY);
  const cheer = useCheer(thinking, shown.at(-1)?.answer ? shown.at(-1)!.id : null);
  const step = run?.step ? plainLine(run.step) : null;
  return (
    <div className="isl-panel">
      <div className="isl-ask-log" aria-live="polite">
        {shown.length === 0 && !thinking && (
          <p className="isl-hint">
            Ask about your chats: who needs you, what’s running, what you spent today.
          </p>
        )}
        {shown.map((exchange) => (
          <div key={exchange.id} className="isl-ask-pair">
            <p className="isl-ask-q">{exchange.question}</p>
            {exchange.answer ? (
              <div className="isl-ask-a">
                <span className="isl-ask-scout" aria-hidden="true">
                  <BlobScout size={16} mood={cheer === exchange.id ? 'happy' : null} />
                </span>
                <div className="isl-ask-md">
                  {exchange.instant ? (
                    <p>{exchange.answer}</p>
                  ) : (
                    <Markdown text={exchange.answer} />
                  )}
                  {exchange.chats.length > 0 && (
                    <div className="isl-acts">
                      {exchange.chats.slice(0, 3).map((chat) => (
                        <button
                          key={chat.id}
                          type="button"
                          className="isl-btn"
                          onClick={() => onOpenChat(chat.id)}
                        >
                          Open “{chat.title}”
                        </button>
                      ))}
                    </div>
                  )}
                  {exchange.instant && (
                    <small className="isl-sub">From what Spark has open right now</small>
                  )}
                </div>
              </div>
            ) : (
              <AskThinking voice={voice} step={step} />
            )}
          </div>
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
          placeholder="Ask Spark about your chats…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="isl-qc-bar">
          <span className="isl-qc-hint">Answers use your default model</span>
          <span className="isl-sp" />
          <button
            type="button"
            className="isl-send"
            aria-label="Ask"
            disabled={!text.trim() || ask.isPending || thinking}
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
      {(ask.isError || assistant.error) && (
        <p className="isl-err" role="alert">
          {(ask.error ?? assistant.error)?.message}
        </p>
      )}
      {assistant.id && (
        <div className="isl-qfoot">
          <span />
          <button type="button" className="isl-btn link" onClick={() => onOpenChat(assistant.id!)}>
            Open the Ask Spark chat
          </button>
        </div>
      )}
    </div>
  );
}
