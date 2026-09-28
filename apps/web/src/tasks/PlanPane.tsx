import './task-panes.css';
import { useId, useState } from 'react';
import {
  artifactMarkdown,
  planChanges,
  providerLabel,
  type AgreedPlans,
  type PlanEntry,
  type PlanVersion,
  type TaskItemState,
  type TaskRun,
} from '@spark-outpost/contracts';
import { CheckIcon, ChevronIcon } from '../ui/icons.tsx';
import { AgreedPlan } from './AgreedPlan.tsx';
import { taskApi } from './task-api.ts';
import { TaskStateIcon } from './TaskIcons.tsx';

const entryStates: Record<PlanEntry['status'], TaskItemState> = {
  completed: 'done',
  in_progress: 'active',
  pending: 'pending',
  failed: 'failed',
};

const statusWords: Record<PlanEntry['status'], string> = {
  completed: 'done',
  in_progress: 'in progress',
  pending: 'not started',
  failed: 'failed',
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function usedBy(version: PlanVersion, runs: readonly TaskRun[]): string {
  const users = runs.filter((run) => version.usedBy.includes(run.id));
  if (users.length === 0) return 'not used yet';
  const names = [...new Set(users.map((run) => providerLabel(run.provider)))];
  const turns = users.length === 1 ? '1 turn' : `${users.length} turns`;
  return `used by ${names.join(', ')} · ${turns}`;
}

function statusRow(content: string, status: PlanEntry['status']) {
  if (status === 'completed') return { kind: 'comp', mark: '✓', label: 'Done', content };
  if (status === 'failed') return { kind: 'fail', mark: '✕', label: 'Failed', content };
  return {
    kind: 'stat',
    mark: '~',
    label: 'Changed',
    content: `${content} · ${statusWords[status]}`,
  };
}

function Diff({ previous, version }: { previous: PlanVersion | undefined; version: PlanVersion }) {
  if (!previous) {
    return (
      <>
        {version.body.entries.map((entry, index) => (
          <div className="pd old" key={index}>
            <i aria-hidden="true">○</i>
            <span>{entry.content}</span>
          </div>
        ))}
        <p className="wnote">First plan, {version.body.entries.length} entries</p>
      </>
    );
  }
  const changes = planChanges(previous.body.entries, version.body.entries);
  const rows = [
    ...changes.added.map((content) => ({ kind: 'add', mark: '+', label: 'Added', content })),
    ...changes.statusChanged.map((change) => statusRow(change.content, change.to)),
    ...changes.removed.map((content) => ({ kind: 'rem', mark: '−', label: 'Removed', content })),
  ];
  if (rows.length === 0) return <p className="wnote">Only priorities or order changed</p>;
  return (
    <>
      {rows.map((row, index) => (
        <div className={`pd ${row.kind}`} key={index}>
          <i aria-hidden="true">{row.mark}</i>
          <span>
            <span className="sr-only">{row.label}: </span>
            {row.content}
          </span>
        </div>
      ))}
    </>
  );
}

function History({ versions }: { versions: readonly PlanVersion[] }) {
  return (
    <div className="phist">
      {versions
        .map((version, index) => ({ version, previous: versions[index - 1] }))
        .reverse()
        .map(({ version, previous }) => (
          <div className={version.supersededBy ? 'pv old' : 'pv'} key={version.version}>
            <div className="pv-h">
              <b>v{version.version}</b>
              <span>{clock(version.createdAt)}</span>
              {version.supersededBy && (
                <span className="sup">replaced by v{version.supersededBy}</span>
              )}
            </div>
            <Diff previous={previous} version={version} />
          </div>
        ))}
    </div>
  );
}

interface PlanPaneProps {
  taskId: string;
  versions: readonly PlanVersion[];
  runs: readonly TaskRun[];
  agreed?: AgreedPlans | undefined;
}

export function PlanPane({ taskId, versions, runs, agreed }: PlanPaneProps) {
  const [history, setHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const historyId = useId();
  const latest = versions.at(-1);
  const agreedPlan = agreed && agreed.documents.length > 0 ? <AgreedPlan plans={agreed} /> : null;
  if (!latest) {
    return agreedPlan ?? <p className="wsec wnote">No plan yet. The agent's plan shows up here.</p>;
  }

  const copy = async () => {
    await navigator.clipboard.writeText(artifactMarkdown('plan', versions));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      {agreedPlan}
      <div className="wsec">
        <div className="wsec-h">
          <h3>{agreedPlan ? 'Agent checklist' : 'Plan'}</h3>
          <span className="vbadge">v{latest.version}</span>
          <span>{usedBy(latest, runs)}</span>
        </div>
        <ul className="plist">
          {latest.body.entries.map((entry, index) => (
            <li key={index} className={entry.status}>
              <TaskStateIcon state={entryStates[entry.status]} />
              <span>
                {entry.content}
                {entry.priority !== 'medium' && (
                  <span className={`prio ${entry.priority}`}>{entry.priority}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="wbtns">
          {versions.length > 1 && (
            <button
              type="button"
              className="btn line sm hist-btn"
              aria-expanded={history}
              aria-controls={historyId}
              onClick={() => setHistory(!history)}
            >
              <ChevronIcon />
              History · {versions.length} versions
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={() => void copy()}>
            {copied ? <CheckIcon /> : null}
            {copied ? 'Copied' : 'Copy as Markdown'}
          </button>
          <a className="btn ghost sm" href={taskApi.markdownUrl(taskId, 'plan')} download>
            Download .md
          </a>
        </div>
        {history && (
          <div id={historyId}>
            <History versions={versions} />
          </div>
        )}
        <span className="sr-only" role="status">
          {copied ? 'Plan copied as Markdown' : ''}
        </span>
      </div>
    </>
  );
}
