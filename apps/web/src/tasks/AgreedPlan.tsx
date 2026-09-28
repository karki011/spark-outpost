import { useId, useState } from 'react';
import {
  PLAN_SOURCE_LABELS,
  type AgreedPlans,
  type PlanDocument,
  type PlanDocumentStatus,
} from '@spark-outpost/contracts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { ChevronIcon } from '../ui/icons.tsx';

const STATUS_LABELS: Record<PlanDocumentStatus, string> = {
  approved: 'Approved',
  proposed: 'Waiting for approval',
  rejected: 'Not approved',
  superseded: 'Replaced',
};

const STALE_FILES_SHOWN = 4;

function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function meta(plan: PlanDocument): string {
  const source = PLAN_SOURCE_LABELS[plan.source];
  return plan.approvedAt
    ? `approved ${when(plan.approvedAt)} · ${source}`
    : `${when(plan.createdAt)} · ${source}`;
}

function StatusBadge({ status }: { status: PlanDocumentStatus }) {
  return <span className={`pstat ${status}`}>{STATUS_LABELS[status]}</span>;
}

function staleText(files: readonly string[]): string {
  const shown = files.slice(0, STALE_FILES_SHOWN).join(', ');
  const more =
    files.length > STALE_FILES_SHOWN ? ` and ${files.length - STALE_FILES_SHOWN} more` : '';
  return `May be out of date: ${shown}${more} changed since it was approved.`;
}

function currentPlan(plans: AgreedPlans): PlanDocument | undefined {
  return plans.documents.findLast((plan) => plan.status === 'approved') ?? plans.documents.at(-1);
}

export function AgreedPlan({ plans }: { plans: AgreedPlans }) {
  const [older, setOlder] = useState(false);
  const olderId = useId();
  const headingId = useId();
  const current = currentPlan(plans);
  if (!current) return null;
  const rest = plans.documents.filter((plan) => plan.id !== current.id).reverse();
  const stale = current.status === 'approved' && plans.staleFiles.length > 0;

  return (
    <section className="wsec agreed" aria-labelledby={headingId}>
      <div className="wsec-h">
        <h3 id={headingId}>Agreed plan</h3>
        <StatusBadge status={current.status} />
        <span className="vbadge">v{current.version}</span>
        <span>{meta(current)}</span>
      </div>
      {stale && <p className="pstale">{staleText(plans.staleFiles)}</p>}
      <div className="agreed-body">
        <Markdown text={current.body} />
      </div>
      {rest.length > 0 && (
        <div className="wbtns">
          <button
            type="button"
            className="btn line sm hist-btn"
            aria-expanded={older}
            aria-controls={olderId}
            onClick={() => setOlder(!older)}
          >
            <ChevronIcon />
            Older versions · {rest.length}
          </button>
        </div>
      )}
      {older && (
        <div id={olderId}>
          {rest.map((plan) => (
            <div className="pv old" key={plan.id}>
              <div className="pv-h">
                <b>v{plan.version}</b>
                <StatusBadge status={plan.status} />
                <span>{meta(plan)}</span>
              </div>
              <div className="agreed-body">
                <Markdown text={plan.body} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
