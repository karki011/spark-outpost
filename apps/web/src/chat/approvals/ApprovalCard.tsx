import './approval-card.css';
import { useId, useState } from 'react';
import {
  friendlyStep,
  isWebToolTitle,
  sparkActionLabels,
  type Approval,
  type ApprovalDecidedValue,
  type Project,
} from '@spark-outpost/contracts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { approvalSummary } from '../status/pending-summary.ts';
import { Pending } from '../status/Pending.tsx';
import { useActionReport } from '../status/status-context.ts';
import { providerName } from '../provider-name.ts';
import { mergeDecision } from './approval-events.ts';
import { outcome } from './approval-outcome.ts';
import { cardTitle, titleText } from './approval-title.ts';
import { PendingApproval } from './PendingApproval.tsx';
import { RetryAction } from './RetryAction.tsx';
import { SparkActionCard } from './SparkActionCard.tsx';
import { SparkRuleCard } from './SparkRuleCard.tsx';
import { McpSettingsButton, isMcpAction } from '../../settings/mcp/McpActionFacts.tsx';

interface ApprovalCardProps {
  approval: Approval;
  provider: string;
  agent?: string;
  repo: Project | null;
}

function subject(approval: Approval): string | null {
  if (approval.payload.sparkAction) return approval.title;
  if (approval.payload.plan) return null;
  if (approval.payload.command) return approval.payload.command;
  if (approval.payload.paths.length > 0) return approval.payload.paths.join(', ');
  if (approval.kind === 'edit') return null;
  return isWebToolTitle(approval.title) ? approval.title : friendlyStep(approval.title);
}

function retired(approval: Approval): boolean {
  return approval.payload.sparkAction?.action === 'open_pr';
}

function ResolvedApproval({ approval }: { approval: Approval }) {
  const headingId = useId();
  const result = outcome(approval);
  const title = cardTitle(approval);
  const shown = title.code ? null : subject(approval);
  const denied = result.icon === 'no';
  const action = approval.payload.sparkAction;
  useActionReport(
    `action:${approval.id}`,
    result.icon === 'busy' && action ? sparkActionLabels[action.action].doing : null,
  );
  const mcpAction = approval.payload.sparkAction && isMcpAction(approval.payload.sparkAction);
  return (
    <div
      className={denied ? 'appr resolved denied' : 'appr resolved'}
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      {result.icon === 'busy' ? (
        <span className="ic appr-busy" aria-hidden="true" />
      ) : (
        <span className="ic" aria-hidden="true">
          {denied ? <XIcon /> : <CheckIcon />}
        </span>
      )}
      <span id={headingId} className="appr-what">
        <b>
          {title.before}
          {title.code && <code>{title.code}</code>}
          {title.after}
        </b>
        {shown && <code title={shown}>{shown}</code>}
      </span>
      <span className="appr-res" role="status">
        <b>{result.label}</b>
        {result.detail}
        {approval.payload.sparkResult?.url && (
          <>
            {' '}
            <a
              href={approval.payload.sparkResult.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open: ${result.label}`}
            >
              Open
            </a>
          </>
        )}
        <RetryAction approval={approval} />
        {mcpAction && approval.status === 'allowed' && (
          <>
            {' '}
            <McpSettingsButton />
          </>
        )}
      </span>
    </div>
  );
}

export function ApprovalCard({ approval: incoming, ...rest }: ApprovalCardProps) {
  const [local, setLocal] = useState<ApprovalDecidedValue | null>(null);
  const approval =
    local && incoming.status === 'pending' ? mergeDecision([incoming], local)[0]! : incoming;
  if (approval.payload.sparkRule) return <SparkRuleCard approval={approval} />;
  if (approval.status !== 'pending' || retired(approval)) {
    return <ResolvedApproval approval={approval} />;
  }
  const agent = rest.agent ?? providerName(rest.provider);
  return (
    <Pending
      id={approval.id}
      order={approval.createdAt}
      summary={approvalSummary(approval, titleText(cardTitle(approval)))}
      pending
    >
      {approval.payload.sparkAction ? (
        <SparkActionCard approval={approval} agent={agent} onDecided={setLocal} />
      ) : (
        <PendingApproval approval={approval} agent={agent} repo={rest.repo} onDecided={setLocal} />
      )}
    </Pending>
  );
}
