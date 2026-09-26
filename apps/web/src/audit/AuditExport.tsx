import { useQuery } from '@tanstack/react-query';
import type { AuditSummary } from '@spark-outpost/contracts';
import { DownloadIcon } from '../ui/icons.tsx';
import { auditApi } from './audit-api.ts';

const PREVIEW_LINES = 6;

async function csvPreview(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The server responded with ${response.status}.`);
  const lines = (await response.text()).trimEnd().split(/\r?\n/);
  const shown = lines.slice(0, PREVIEW_LINES);
  return lines.length > PREVIEW_LINES ? `${shown.join('\n')}\n…` : shown.join('\n');
}

export function AuditExport({
  conversationId,
  summary,
}: {
  conversationId: string;
  summary: AuditSummary;
}) {
  const csvUrl = auditApi.exportUrl(conversationId, 'csv');
  const jsonlUrl = auditApi.exportUrl(conversationId, 'jsonl');
  const preview = useQuery({
    queryKey: ['audit', conversationId, 'csv-preview', summary.totals.runs],
    queryFn: () => csvPreview(csvUrl),
  });
  const messages = summary.runs.reduce((total, run) => total + run.logEntries, 0);
  return (
    <>
      <p className="lede">
        Take this chat with you. The JSONL export has every recorded ACP message with its hash, so
        anyone can check the chain again. Secrets are redacted before anything is stored.
      </p>
      <div className="xrow">
        <div className="xcard">
          <b>Messages as JSONL</b>
          <p>
            {summary.runs.length} {summary.runs.length === 1 ? 'run' : 'runs'} and {messages}{' '}
            protocol {messages === 1 ? 'message' : 'messages'}, one per line.
          </p>
          <a className="btn primary sm" href={jsonlUrl} download>
            <DownloadIcon />
            Download .jsonl
          </a>
        </div>
        <div className="xcard">
          <b>Cost as CSV</b>
          <p>Tokens, cost, and cost source per run, for spreadsheets.</p>
          <a className="btn line sm" href={csvUrl} download>
            <DownloadIcon />
            Download .csv
          </a>
        </div>
      </div>
      <h4 className="ah">Preview · cost.csv</h4>
      <pre className="xprev" tabIndex={0} aria-label="CSV preview">
        {preview.data ?? (preview.isError ? preview.error.message : 'Loading…')}
      </pre>
    </>
  );
}
