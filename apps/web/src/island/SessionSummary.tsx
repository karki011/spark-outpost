import './island-home-summary.css';
import { TerminalIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import type { SessionFacts, SessionNote } from './session-summary.ts';

function TerminalChip() {
  return (
    <span className="isl-now-chip">
      <TerminalIcon />
      Terminal session
    </span>
  );
}

function Note({ note, chip }: { note: SessionNote | null; chip: boolean }) {
  const said = note?.tone === 'said' ? ' isl-now-said' : '';
  return (
    <p className={`isl-now-note${said}`} data-tone={note?.tone} title={note?.text}>
      {chip && <TerminalChip />}
      {note?.lead && <span className="sr-only">{note.lead}</span>}
      {note?.text}
    </p>
  );
}

interface FactsProps {
  title: string;
  facts: SessionFacts;
  onReply: (() => void) | null;
}

function Facts({ title, facts, onReply }: FactsProps) {
  const text = facts.parts.join(' · ');
  return (
    <div className="isl-now-facts">
      <span className="isl-now-fact" title={text || undefined}>
        {text}
      </span>
      <time
        className="isl-now-when"
        dateTime={facts.changedAt}
        title={new Date(facts.changedAt).toLocaleString()}
      >
        {relativeTime(facts.changedAt)}
      </time>
      {onReply && (
        <button
          type="button"
          className="isl-now-reply"
          aria-label={`Reply to ${title}`}
          title="Opens this chat here with the reply box ready"
          onClick={onReply}
        >
          Reply
        </button>
      )}
    </div>
  );
}

interface SessionSummaryProps {
  title: string;
  notes: readonly SessionNote[];
  facts: SessionFacts | null;
  onReply: (() => void) | null;
}

export function SessionSummary({ title, notes, facts, onReply }: SessionSummaryProps) {
  const chip = facts?.terminal ?? false;
  const shown: readonly (SessionNote | null)[] = notes.length === 0 && chip ? [null] : notes;
  if (shown.length === 0 && !facts) return null;
  return (
    <div className="isl-now-sum" data-many={shown.length > 1 ? '' : undefined}>
      {shown.map((note, at) => (
        <Note key={note?.tone ?? 'kind'} note={note} chip={chip && at === 0} />
      ))}
      {facts && <Facts title={title} facts={facts} onReply={onReply} />}
    </div>
  );
}
