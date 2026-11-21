import './automated-turn.css';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isTerminalRunStatus, type ConversationDetail, type Run } from '@spark-outpost/contracts';
import { api } from '../../api/client.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { ChevronIcon, ExternalLinkIcon, RefreshIcon } from '../../ui/icons.tsx';
import { ReviewMarkdown } from '../markdown/ReviewMarkdown.tsx';
import { usePaneId } from '../split/chat-pane.ts';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { turnRunIds } from '../turn-props.ts';
import { turnSteers } from '../steer/steer-model.ts';
import { opensOnItsOwn, sentForDisplay, waitsOnYou } from './automated-model.ts';
import {
  itemPlace,
  itemWord,
  roundItems,
  roundOfTurn,
  roundSubtitle,
  roundTitle,
  type TurnRound,
} from './round-card-model.ts';

export function SentBySpark({ text, label }: { text: string; label?: string }) {
  return (
    <details className="auto-turn-sent">
      <summary>{label ?? 'Show what Spark sent'}</summary>
      <div className="bubble">
        <ReviewMarkdown text={sentForDisplay(text)} />
      </div>
    </details>
  );
}

function RoundItems({ found }: { found: TurnRound }) {
  const items = roundItems(found);
  if (items.length === 0) return null;
  return (
    <ul className="auto-turn-items" aria-label="Review items in this round">
      {items.map((item) => (
        <li key={item.id}>
          <span
            className="auto-turn-word"
            data-triage={item.kind === 'check' ? 'check' : item.triage}
          >
            {itemWord(item)}
          </span>
          <span className="auto-turn-item">
            <small>{itemPlace(item)}</small>
            <span>{item.excerpt}</span>
          </span>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hlink">
              Open
              <ExternalLinkIcon />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

interface AgentStepsProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

function AgentSteps({ open, onToggle, children }: AgentStepsProps) {
  return (
    <details
      className="auto-turn-steps"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>Agent steps</summary>
      <div className="auto-turn-work">{children}</div>
    </details>
  );
}

interface AutomatedTurnProps {
  run: Run;
  detail: ConversationDetail;
  message: string;
  children: ReactNode;
}

export function AutomatedTurn({ run, detail, message, children }: AutomatedTurnProps) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [stepsChosen, setStepsChosen] = useState<boolean | null>(null);
  const found = useQuery({
    ...prWatchesQuery(detail.conversation.id),
    select: (list) => roundOfTurn(list.watches, run.id),
    notifyOnChangeProps: ['data'],
  }).data;
  const stop = useMutation({ mutationFn: () => api.cancelRun(run.id) });
  const live = !isTerminalRunStatus(run.status);
  const waiting = waitsOnYou(detail.approvals, turnRunIds(detail, run.id));
  const steered = turnSteers(detail, run.id).length > 0;
  const open = chosen ?? (live || opensOnItsOwn(run.status, { waiting, steered }));
  const stepsOpen = stepsChosen ?? opensOnItsOwn(run.status, { waiting, steered });
  const bodyId = usePaneId(`auto-turn-${run.id}`);
  const title = roundTitle(found ?? null);
  return (
    <div className="auto-turn" data-open={open} data-live={live}>
      <div className="auto-turn-row">
        <button
          type="button"
          className="auto-turn-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setChosen(!open)}
        >
          <ChevronIcon />
          <span className="auto-turn-ic" aria-hidden="true">
            <RefreshIcon />
          </span>
          <b>{title}</b>
          <span>{roundSubtitle(found ?? null, message, live)}</span>
        </button>
        {live && (
          <button
            type="button"
            className="btn line sm"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            Stop turn
          </button>
        )}
      </div>
      <div id={bodyId} className="auto-turn-body" hidden={!open}>
        {found && <RoundItems found={found} />}
        <AgentSteps open={stepsOpen} onToggle={setStepsChosen}>
          {children}
        </AgentSteps>
        <p className="auto-turn-foot">
          {message && <SentBySpark text={message} />}
          <button type="button" className="hlink" onClick={() => requestSettings('pulls')}>
            Follow-up settings
          </button>
        </p>
      </div>
    </div>
  );
}
