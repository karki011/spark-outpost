import type { ReactNode, Ref } from 'react';
import { holdsToConfirm, type Approval } from '@spark-outpost/contracts';
import { PenIcon, ShieldIcon, TerminalIcon, WarnIcon } from '../../ui/icons.tsx';
import type { CardTitle } from './approval-title.ts';
import { CARD_FOCUS } from './card-keys.ts';

function TitleIcon({ approval }: { approval: Approval }) {
  if (holdsToConfirm(approval.payload)) return <WarnIcon />;
  if (approval.payload.instructionFiles || approval.reason !== null) return <ShieldIcon />;
  if (approval.kind === 'edit') return <PenIcon />;
  if (approval.kind === 'execute') return <TerminalIcon />;
  return <ShieldIcon />;
}

interface ApprovalTitleProps {
  approval: Approval;
  title: CardTitle;
  headingId: string;
  meta: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function ApprovalTitle({ approval, title, headingId, meta, ref }: ApprovalTitleProps) {
  return (
    <div ref={ref} className="appr-h" tabIndex={0} {...{ [CARD_FOCUS]: '' }}>
      <span className="ic" aria-hidden="true">
        <TitleIcon approval={approval} />
      </span>
      <span id={headingId} className="appr-q">
        {title.before}
        {title.code && <code>{title.code}</code>}
        {title.after}
      </span>
      {meta && <span className="appr-meta">{meta}</span>}
    </div>
  );
}
