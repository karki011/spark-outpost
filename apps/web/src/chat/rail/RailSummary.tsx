import type { ReactNode } from 'react';
import { BranchIcon, CheckIcon, FolderIcon, ShieldIcon } from '../../ui/icons.tsx';
import { WhoIcon } from '../../tasks/TaskIcons.tsx';
import { Counts } from '../changes/FileChangeList.tsx';
import { ChangesIcon, PullRequestIcon, UsageIcon } from './RailIcons.tsx';
import type { RailAction, RailRow, RailRowId } from './rail-model.ts';

interface RailSummaryProps {
  rows: readonly RailRow[];
  provider: string;
  onAction(action: RailAction): void;
}

function rowIcon(id: RailRowId, provider: string): ReactNode {
  if (id === 'project') return <FolderIcon />;
  if (id === 'agent') return <WhoIcon provider={provider} />;
  if (id === 'autonomy') return <ShieldIcon />;
  if (id === 'changes') return <ChangesIcon />;
  if (id === 'checks') return <CheckIcon className="crail-check" />;
  if (id === 'pr') return <PullRequestIcon />;
  return <UsageIcon />;
}

function RowBody({ row, provider }: { row: RailRow; provider: string }) {
  return (
    <>
      <span className="crail-ico" aria-hidden="true">
        {rowIcon(row.id, provider)}
      </span>
      <span className="crail-text">
        <span className="crail-main">
          {row.text}
          {row.counts && <Counts added={row.counts.added} removed={row.counts.removed} />}
        </span>
        {row.detail && (
          <span className="crail-detail">
            {row.onBranch && <BranchIcon />}
            {row.detail}
          </span>
        )}
      </span>
    </>
  );
}

export function RailSummary({ rows, provider, onAction }: RailSummaryProps) {
  return (
    <ul className="crail-rows" aria-label="This chat">
      {rows.map((row) => {
        const className = row.tone ? `crail-row ${row.tone}` : 'crail-row';
        const body = <RowBody row={row} provider={provider} />;
        const { action } = row;
        return (
          <li key={row.id} data-row={row.id}>
            {action?.kind === 'link' && (
              <a
                className={className}
                href={action.href}
                target="_blank"
                rel="noreferrer"
                aria-label={row.label}
              >
                {body}
              </a>
            )}
            {action && action.kind !== 'link' && (
              <button
                type="button"
                className={className}
                aria-label={row.label}
                onClick={() => onAction(action)}
              >
                {body}
              </button>
            )}
            {!action && <div className={className}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
