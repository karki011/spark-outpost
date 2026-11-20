import './automated-turn.css';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { ReviewMarkdown } from '../markdown/ReviewMarkdown.tsx';
import { usePaneId } from '../split/chat-pane.ts';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { outcomesIn } from '../pull-request/round-model.ts';
import { turnRunIds } from '../turn-props.ts';
import { opensOnItsOwn, roundHeadline, sentForDisplay, waitsOnYou } from './automated-model.ts';

interface AutomatedTurnProps {
  run: Run;
  detail: ConversationDetail;
  message: string;
  children: ReactNode;
}

function RoundHeadline({ run, conversationId, message }: HeadlineProps) {
  const outcome = useQuery({
    ...prWatchesQuery(conversationId),
    select: (list) => outcomesIn(list.watches, [run.id])[0] ?? null,
    notifyOnChangeProps: ['data'],
  }).data;
  return (
    <>
      <b>PR follow-up</b>
      <span>{roundHeadline(outcome ?? null, message, run.status)}</span>
    </>
  );
}

interface HeadlineProps {
  run: Run;
  conversationId: string;
  message: string;
}

export function SentBySpark({ text }: { text: string }) {
  return (
    <details className="auto-turn-sent">
      <summary>Show what Spark sent</summary>
      <div className="bubble">
        <ReviewMarkdown text={sentForDisplay(text)} />
      </div>
    </details>
  );
}

export function AutomatedTurn({ run, detail, message, children }: AutomatedTurnProps) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const waiting = waitsOnYou(detail.approvals, turnRunIds(detail, run.id));
  const open = chosen ?? opensOnItsOwn(run.status, waiting);
  const bodyId = usePaneId(`auto-turn-${run.id}`);
  return (
    <div className="auto-turn" data-open={open}>
      <div className="auto-turn-row">
        <button
          type="button"
          className="auto-turn-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setChosen(!open)}
        >
          <ChevronIcon />
          <RoundHeadline run={run} conversationId={detail.conversation.id} message={message} />
        </button>
      </div>
      <div id={bodyId} className="auto-turn-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
