import './task-list.css';
import { memo, useDeferredValue, useId, useState } from 'react';
import { waitingApprovalId, type TaskListItem } from '@spark-outpost/contracts';
import { commandApproval } from '../chat/status/pending-summary.ts';
import { commandFull, commandSummary } from '../chat/status/status-text.ts';
import { SummaryText } from '../chat/status/SummaryText.tsx';
import { approvalAnchor } from '../crew/conversation-crew.ts';
import { scrollToAnchor } from '../crew/scroll-to-anchor.ts';
import { ChevronIcon } from '../ui/icons.tsx';
import { shortenPaths } from './short-paths.ts';
import { HarnessIcon, TaskStateIcon } from './TaskIcons.tsx';

const SHOW_DONE_KEY = 'spark-outpost.tasks.show-done';
const FIRST_ROWS = 30;

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

interface DecisionTag {
  text: string;
  tone: 'ok' | 'bad';
}

function actionTag(item: TaskListItem): DecisionTag | null {
  if (item.state === 'failed') return { text: 'Failed', tone: 'bad' };
  return item.state === 'done' ? { text: 'Done', tone: 'ok' } : null;
}

function decisionTag(item: TaskListItem): DecisionTag | null {
  if (!waitingApprovalId(item) || item.state === 'waiting') return null;
  if (item.action) return actionTag(item);
  return item.state === 'done'
    ? { text: 'Allowed', tone: 'ok' }
    : { text: 'Not allowed', tone: 'bad' };
}

function outputLabel(item: TaskListItem): string {
  return item.id.startsWith('shortcut:') ? 'Deferred shortcuts' : 'Check output';
}

function fullLabel(item: TaskListItem): string {
  return item.command ? commandFull(item.label) : item.label;
}

function fullText(item: TaskListItem): string {
  return item.hint ? `${fullLabel(item)}\n${item.hint}` : fullLabel(item);
}

function rowLabel(item: TaskListItem, roots: readonly string[]): string {
  const short = shortenPaths(item.label, roots);
  return item.command ? commandSummary(short) : short;
}

const WAITING_PREFIX = 'Waiting for you: ';

function waitingSubject(item: TaskListItem): string {
  return item.label.startsWith(WAITING_PREFIX)
    ? item.label.slice(WAITING_PREFIX.length)
    : item.label;
}

function TaskRow({ item, roots }: { item: TaskListItem; roots: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const label = rowLabel(item, roots);
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
        <span className="ti-av" title="Spark">
          <HarnessIcon />
        </span>
      </button>
      {open && (
        <div className="ti-more" id={moreId}>
          {showFull && <code className="ti-full">{fullLabel(item)}</code>}
          Spark
          {item.detail ? ` · ${item.detail}` : ''}
          {item.url && (
            <>
              {' · '}
              <a href={item.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </>
          )}
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

function sameRow(
  before: { item: TaskListItem; roots: readonly string[] },
  after: { item: TaskListItem; roots: readonly string[] },
): boolean {
  return (
    before.item === after.item &&
    before.roots.length === after.roots.length &&
    before.roots.every((root, index) => root === after.roots[index])
  );
}

const ListRow = memo(TaskRow, sameRow);

interface TaskListProps {
  items: readonly TaskListItem[];
  roots: readonly string[];
}

export function TaskList({ items, roots }: TaskListProps) {
  const [showDone, setShowDone] = useState(readShowDone);
  const doneId = useId();
  const done = items.filter((item) => item.state === 'done');
  const shownDone = useDeferredValue(done, done.slice(0, FIRST_ROWS));
  const rest = items.filter((item) => item.state !== 'done' && item.state !== 'waiting');
  return (
    <>
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
              {shownDone.map((item) => (
                <ListRow key={item.id} item={item} roots={roots} />
              ))}
            </ul>
          )}
        </>
      )}
      {rest.length > 0 && (
        <ul className="tlist" aria-label="Not done">
          {rest.map((item) => (
            <ListRow key={item.id} item={item} roots={roots} />
          ))}
        </ul>
      )}
    </>
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
        const command = item.command
          ? commandApproval(shortenPaths(waitingSubject(item), roots))
          : null;
        return (
          <li key={item.id} className="wp-wait">
            <TaskStateIcon state="waiting" />
            <span>
              {command ? (
                <b className="cmd" title={commandFull(waitingSubject(item))}>
                  <SummaryText summary={command} lead />
                </b>
              ) : (
                <b title={item.hint ?? item.label}>{shortenPaths(item.label, roots)}</b>
              )}
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
