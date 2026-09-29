import './task-list.css';
import { useId, useState } from 'react';
import {
  providerLabel,
  waitingApprovalId,
  type TaskItemState,
  type TaskListItem,
} from '@spark-outpost/contracts';
import { approvalAnchor } from '../crew/conversation-crew.ts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { CrewState } from '../crew/crew-model.ts';
import { scrollToAnchor } from '../crew/scroll-to-anchor.ts';
import { ChevronIcon } from '../ui/icons.tsx';
import { usageLine } from '../usage/format.ts';
import { shortenPaths } from './short-paths.ts';
import { TaskStateIcon, WhoIcon } from './TaskIcons.tsx';

const CREW_STATES: Record<TaskItemState, CrewState> = {
  done: 'done',
  active: 'working',
  waiting: 'waiting',
  pending: 'queued',
  failed: 'failed',
};

const SHOW_DONE_KEY = 'spark-outpost.tasks.show-done';

function readShowDone(): boolean {
  try {
    return localStorage.getItem(SHOW_DONE_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveShowDone(show: boolean): void {
  try {
    localStorage.setItem(SHOW_DONE_KEY, show ? '1' : '0');
  } catch {
    return;
  }
}

function agentLine(item: TaskListItem): string {
  if (!item.agent) return 'Harness';
  const { provider, model, effort } = item.agent;
  return [providerLabel(provider), model, effort].filter(Boolean).join(' · ');
}

interface DecisionTag {
  text: string;
  tone: 'ok' | 'bad';
}

function decisionTag(item: TaskListItem): DecisionTag | null {
  if (!waitingApprovalId(item) || item.state === 'waiting') return null;
  return item.state === 'done'
    ? { text: 'Allowed', tone: 'ok' }
    : { text: 'Not allowed', tone: 'bad' };
}

function outputLabel(item: TaskListItem): string {
  return item.id.startsWith('shortcut:') ? 'Deferred shortcuts' : 'Check output';
}

function fullText(item: TaskListItem): string {
  return item.hint ? `${item.label}\n${item.hint}` : item.label;
}

function TaskRow({ item, roots }: { item: TaskListItem; roots: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const numbers = usageLine(item.tokens ?? null, item.costUsd ?? null, item.costSource);
  const label = shortenPaths(item.label, roots);
  const tag = decisionTag(item);
  const showFull = item.command || label !== item.label;
  return (
    <li className={`titem ${item.state}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="ti-row"
        aria-expanded={open}
        aria-controls={moreId}
        onClick={() => setOpen(!open)}
      >
        <TaskStateIcon state={item.state} />
        <span className={item.command ? 'ti-t cmd' : 'ti-t'} title={fullText(item)}>
          {label}
        </span>
        {tag && <span className={`ti-tag ${tag.tone}`}>{tag.text}</span>}
        <span className="ti-av" title={agentLine(item)}>
          {item.role && item.agent ? (
            <span className="mb" aria-hidden="true">
              <CrewBlob
                name={item.name ?? item.role}
                provider={item.agent.provider}
                state={CREW_STATES[item.state]}
                size={16}
              />
            </span>
          ) : (
            <WhoIcon provider={item.agent?.provider} />
          )}
        </span>
      </button>
      {open && (
        <div className="ti-more" id={moreId}>
          {showFull && <code className="ti-full">{item.label}</code>}
          {agentLine(item)}
          {item.detail ? ` · ${item.detail}` : ''}
          {numbers ? ` · ${numbers}` : ''}
          {item.output && (
            <pre className="ti-out" tabIndex={0} aria-label={outputLabel(item)}>
              {item.output}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

interface TaskListProps {
  items: readonly TaskListItem[];
  roots: readonly string[];
}

export function TaskList({ items, roots }: TaskListProps) {
  const [showDone, setShowDone] = useState(readShowDone);
  const doneId = useId();
  const done = items.filter((item) => item.state === 'done');
  const rest = items.filter((item) => item.state !== 'done' && item.state !== 'waiting');
  return (
    <div className="wsec">
      {done.length > 0 && (
        <>
          <button
            type="button"
            className="tdone"
            aria-expanded={showDone}
            aria-controls={doneId}
            onClick={() => {
              setShowDone(!showDone);
              saveShowDone(!showDone);
            }}
          >
            <ChevronIcon />
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
          {showDone && (
            <ul className="tlist" id={doneId} aria-label="Done">
              {done.map((item) => (
                <TaskRow key={item.id} item={item} roots={roots} />
              ))}
            </ul>
          )}
        </>
      )}
      {rest.length > 0 ? (
        <ul className="tlist" aria-label="Remaining">
          {rest.map((item) => (
            <TaskRow key={item.id} item={item} roots={roots} />
          ))}
        </ul>
      ) : (
        <p className="wnote">All done.</p>
      )}
    </div>
  );
}

interface WaitingItemsProps {
  items: readonly TaskListItem[];
  roots: readonly string[];
  onReview?: () => void;
}

export function WaitingItems({ items, roots, onReview }: WaitingItemsProps) {
  const waiting = items.filter((item) => item.state === 'waiting');
  if (waiting.length === 0) return null;
  return (
    <ul className="wp-waits" aria-label="Waiting for you">
      {waiting.map((item) => {
        const approvalId = waitingApprovalId(item);
        return (
          <li key={item.id} className="wp-wait">
            <TaskStateIcon state="waiting" />
            <span>
              <b className={item.command ? 'cmd' : undefined} title={item.hint ?? item.label}>
                {shortenPaths(item.label, roots)}
              </b>
              {item.detail && <small>{item.detail}</small>}
            </span>
            {approvalId && (
              <button
                type="button"
                className="btn primary sm"
                onClick={() => {
                  onReview?.();
                  scrollToAnchor(approvalAnchor(approvalId));
                }}
              >
                Review
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
