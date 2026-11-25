import './sub-chats.css';
import { useId, useState } from 'react';
import {
  ALSO_SAID,
  NONE_STATED,
  REPORT_FOOTER,
  REPORT_FOR,
  shownChatTitle,
  type SubChatReport,
} from '@spark-outpost/contracts';
import { SubChatStatusWord } from '../../conversations/SubChatStatusWord.tsx';
import { pullRequestFact } from '../../tasks/sub-chats-pane.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { ReviewMarkdown } from '../markdown/ReviewMarkdown.tsx';
import { usePaneId } from '../split/chat-pane.ts';

function BranchRecord({ report }: { report: SubChatReport }) {
  const pull = report.pullRequest;
  const facts = [
    report.committed ? 'committed' : 'not committed',
    report.pushed ? 'pushed' : 'not pushed',
  ];
  return (
    <p className="sc-report-record">
      {report.branch ? <code>{report.branch}</code> : 'No branch'}
      {` · ${facts.join(' · ')} · `}
      {pull ? (
        <>
          <a
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Pull request ${pull.number}`}
          >
            #{pull.number}
          </a>
          {` · ${pullRequestFact(pull)}`}
        </>
      ) : (
        pullRequestFact(null)
      )}
    </p>
  );
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <ReviewMarkdown text={text.trim() || NONE_STATED} />
      </dd>
    </>
  );
}

interface ReportBlockProps {
  from: { id: string | null; title: string };
  report: SubChatReport;
  onOpenChat?: ((conversationId: string) => void) | undefined;
}

export function ReportBlock({ from, report, onOpenChat }: ReportBlockProps) {
  const title = shownChatTitle(from.title);
  const fromId = from.id;
  const bodyId = usePaneId(useId());
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? report.status === 'needs_you';
  return (
    <section className="sc-card sc-report" data-open={open} aria-label={`Report from ${title}`}>
      <header className="sc-card-h">
        <h3>
          <button
            type="button"
            className="sc-report-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setChosen(!open)}
          >
            <ChevronIcon />
            Report
          </button>
          {' · '}
          {fromId && onOpenChat ? (
            <button type="button" className="sc-link" onClick={() => onOpenChat(fromId)}>
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        <SubChatStatusWord status={report.status} />
        <span className="sc-card-by">{REPORT_FOR}</span>
      </header>
      <div id={bodyId} hidden={!open}>
        <dl className="sc-report-b">
          {report.reason && <Section label="What happened" text={report.reason} />}
          <Section label="Changed" text={report.changed} />
          <dt>Branch and pull request</dt>
          <dd>
            <BranchRecord report={report} />
          </dd>
          <Section label="Risks" text={report.risks} />
          <Section label="Blockers" text={report.blockers} />
          {report.said.trim() && <Section label={ALSO_SAID} text={report.said} />}
        </dl>
        <p className="sc-card-f">{REPORT_FOOTER}</p>
      </div>
    </section>
  );
}
