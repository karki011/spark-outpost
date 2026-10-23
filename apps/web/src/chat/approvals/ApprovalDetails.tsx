import { useId, useState, type ReactNode } from 'react';
import type { Approval } from '@spark-outpost/contracts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { askReason, fromSandbox } from './ask-reason.ts';

interface DetailsProps {
  approval: Approval;
  agent: string;
  cwd: string | null;
  branch: string | null;
}

function commandNote(approval: Approval): string | null {
  if (approval.reason !== null) return null;
  if (approval.payload.asksBecause) return `${approval.payload.asksBecause}.`;
  if (approval.payload.agentReason) return null;
  return "It isn't on the project's allowlist yet.";
}

function showsRunsIn(approval: Approval, cwd: string | null): boolean {
  return approval.kind === 'execute' && Boolean(cwd || commandNote(approval));
}

function RunsIn({ approval, cwd, branch }: Omit<DetailsProps, 'agent'>) {
  const note = commandNote(approval);
  return (
    <p>
      {cwd && (
        <>
          Runs in <code>{cwd}</code>
          {branch && (
            <>
              {' '}
              on <code>{branch}</code>
            </>
          )}
          .{' '}
        </>
      )}
      {note}
    </p>
  );
}

function AgentReason({ approval, agent }: { approval: Approval; agent: string }) {
  const reason = askReason(approval, agent);
  if (!reason) return null;
  const own = approval.payload.agentReason;
  return (
    <p>
      {reason}
      {own && fromSandbox(own) && <span className="appr-agent-says"> {own}</span>}
    </p>
  );
}

function detailLines(props: DetailsProps): ReactNode[] {
  const { approval } = props;
  const lines: ReactNode[] = [];
  if (showsRunsIn(approval, props.cwd)) lines.push(<RunsIn key="runs" {...props} />);
  if (askReason(approval, props.agent)) {
    lines.push(<AgentReason key="reason" approval={approval} agent={props.agent} />);
  }
  if (approval.kind === 'edit') {
    lines.push(
      <p key="edit">The change lands in your working tree. You can revert this run afterwards.</p>,
    );
  }
  return lines;
}

export function useApprovalDetails(props: DetailsProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const lines = detailLines(props);
  const toggle =
    lines.length === 0 ? null : (
      <button
        type="button"
        className="appr-det"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Details
        <ChevronIcon />
      </button>
    );
  const panel = open && lines.length > 0 && (
    <div id={id} className="appr-det-body">
      {lines}
    </div>
  );
  return { toggle, panel };
}
