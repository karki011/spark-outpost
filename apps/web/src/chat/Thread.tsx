import './thread.css';
import { useCallback, useEffect, useRef } from 'react';
import { PERMISSION_DO, type ConversationDetail, type Project } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { ArrowDownIcon } from '../ui/icons.tsx';
import { MessageAttachments } from './attachments/MessageAttachments.tsx';
import type { OutgoingMessage } from './ChatView.tsx';
import { AdviceLine } from './AdviceLine.tsx';
import { repoSummary } from './project/repo-list.ts';
import { buildTurns } from './turns.ts';
import { SoloTurn } from './SoloTurn.tsx';
import { useStickToBottom } from './use-stick-to-bottom.ts';
import { TaskCard } from '../tasks/TaskCard.tsx';
import { CrewTurn } from './crew/CrewTurn.tsx';
import { crewAgents } from '../crew/crew-projection.ts';
import { isCrewTurn } from '../crew/conversation-crew.ts';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { QuotedText } from './quotes/QuotedText.tsx';
import { QuoteMarks } from './quotes/QuoteMarks.tsx';
import { QuoteToolbar } from './quotes/QuoteToolbar.tsx';
import type { QuotesState } from './quotes/use-quotes.ts';

interface ThreadProps {
  detail: ConversationDetail;
  repos: Project[];
  pendingMessage: OutgoingMessage | null;
  panelOpen?: boolean;
  onOpenTask?: (taskId: string) => void;
  quotes?: QuotesState;
}

export function Thread({
  detail,
  repos,
  pendingMessage,
  panelOpen = false,
  onOpenTask,
  quotes,
}: ThreadProps) {
  const { scrollerRef, away, follow, jumpToLatest } = useStickToBottom();
  const quoteRootRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useCallback(
    (scroller: HTMLDivElement | null) => {
      quoteRootRef.current = scroller;
      return scrollerRef(scroller);
    },
    [scrollerRef],
  );
  const turns = buildTurns(detail);
  const parentOf = new Map(detail.runs.map((run) => [run.id, run.parentRunId ?? run.id]));
  const taskAfterRun = new Map(
    detail.tasks.map((task) => {
      const last = task.runIds.at(-1);
      return [last ? (parentOf.get(last) ?? last) : undefined, task];
    }),
  );
  const crewRun = (runId: string) => {
    const orchestration = detail.orchestrations?.[runId] ?? null;
    return isCrewTurn(orchestration) ? orchestration : null;
  };
  const taskCard = (runId: string) => {
    const task = taskAfterRun.get(runId);
    if (!onOpenTask || !task) return null;
    const orchestration = crewRun(runId);
    const crew = orchestration ? crewAgents(orchestration, detail.activity) : [];
    return (
      <TaskCard
        task={task}
        panelOpen={panelOpen}
        onOpen={() => onOpenTask(task.id)}
        agents={crew}
      />
    );
  };

  useEffect(() => {
    if (pendingMessage) follow();
  }, [pendingMessage, follow]);

  if (turns.length === 0 && !pendingMessage) {
    return (
      <div className="thread-wrap">
        <div className="empty">
          <BlobScout size={64} />
          <h2>What should we work on?</h2>
          {repos.length > 0 ? (
            <p>
              New chat in <b>{repoSummary(repos.map((repo) => repo.name))}</b>.{' '}
              {detail.settings.permission === PERMISSION_DO ? (
                <>Your AI can change files here, and asks first as your permissions say.</>
              ) : (
                <>
                  Your AI can read {repos.length === 1 ? "this folder's" : "these folders'"} files
                  but won't change them.
                </>
              )}
            </p>
          ) : (
            <p>
              Chats here have no project folder yet, so your AI can answer and explain but can't
              read or change files.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="thread-wrap">
      <div className="thread" ref={threadRef}>
        <div className="col">
          {turns.map(({ run, userMessage, assistantMessage }) => (
            <section
              key={run.id}
              aria-label="Turn"
              data-assistant-message-id={assistantMessage?.id}
            >
              {userMessage && (
                <div className="msg me" data-message-id={userMessage.id}>
                  <MessageAttachments attachments={userMessage.attachments} />
                  {userMessage.content && (
                    <>
                      <div className="bubble">
                        <QuotedText text={userMessage.content} />
                      </div>
                      <MessageActions
                        text={userMessage.content}
                        createdAt={userMessage.createdAt}
                        copyLabel="Copy message"
                        side="user"
                      />
                    </>
                  )}
                </div>
              )}
              {crewRun(run.id) ? (
                <CrewTurn
                  run={run}
                  detail={detail}
                  orchestration={crewRun(run.id)!}
                  repo={repos[0] ?? null}
                  taskCard={taskCard(run.id)}
                />
              ) : (
                <SoloTurn
                  run={run}
                  detail={detail}
                  assistantMessage={assistantMessage}
                  repo={repos[0] ?? null}
                />
              )}
              {!crewRun(run.id) && (
                <>
                  <AdviceLine advice={detail.advice?.[run.id]} />
                  {taskCard(run.id)}
                </>
              )}
            </section>
          ))}
          {pendingMessage && (
            <div className="msg me">
              <MessageAttachments attachments={pendingMessage.attachments} />
              {pendingMessage.content && (
                <div className="bubble pending">
                  <QuotedText text={pendingMessage.content} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {quotes && (
        <>
          <QuoteToolbar scrollerRef={quoteRootRef} quotes={quotes} />
          <QuoteMarks
            scrollerRef={quoteRootRef}
            conversationId={detail.conversation.id}
            pending={quotes.items}
          />
        </>
      )}
      <button type="button" className={away ? 'jump show' : 'jump'} onClick={jumpToLatest}>
        <ArrowDownIcon />
        Jump to latest
      </button>
    </div>
  );
}
