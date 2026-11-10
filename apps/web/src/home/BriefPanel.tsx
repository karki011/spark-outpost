import './digest.css';
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import type { Digest } from '@spark-outpost/contracts';
import { AuditDialog } from '../audit/AuditDialog.tsx';
import { CalendarBriefBlock } from '../calendar/CalendarBriefBlock.tsx';
import { BlobScout } from '../brand/BlobScout.tsx';
import { briefOffLine, nothingFlagged, type Voice } from '../spark/voice.ts';
import { HomeRow, HomeRows, RowAction } from './HomeCards.tsx';
import { readDetailsOpen, writeDetailsOpen } from './digest-details.ts';
import { canRefresh, digestMeta, refreshHint } from './digest-model.ts';
import { writingMeta, type BriefEntry } from './needs-model.ts';
import type { Brief } from './use-brief.ts';

interface BriefItemsProps {
  entries: readonly BriefEntry[];
  label: string;
  onEntry: (entry: BriefEntry) => void;
}

function BriefItems({ entries, label, onEntry }: BriefItemsProps) {
  if (entries.length === 0) return null;
  return (
    <HomeRows label={label}>
      {entries.map((entry, index) => (
        <HomeRow
          key={entry.id}
          index={index}
          label={<span className="hkey">{entry.key ?? 'Chat'}</span>}
          title={entry.title || entry.text}
          line={entry.title ? entry.text : undefined}
          trailing={
            <RowAction
              label={entry.verb}
              name={`${entry.verb} ${entry.key ?? entry.title}`}
              onClick={() => onEntry(entry)}
            />
          }
        />
      ))}
    </HomeRows>
  );
}

function Away({ digest, onOpenChat }: { digest: Digest; onOpenChat: (id: string) => void }) {
  const [open, setOpen] = useState(readDetailsOpen);
  const listId = useId();
  const lines = digest.body?.lines ?? [];
  if (lines.length === 0) return null;
  const toggle = () => {
    writeDetailsOpen(!open);
    setOpen(!open);
  };
  return (
    <>
      <button
        type="button"
        className="hlink dg-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
      >
        {open ? 'Hide' : 'Show'} what happened since you were away ({lines.length})
      </button>
      <ul id={listId} className="dg-lines" hidden={!open}>
        {lines.map((line, index) => (
          <li key={index}>
            {line.chatId ? (
              <button type="button" className="dg-line" onClick={() => onOpenChat(line.chatId!)}>
                {line.text}
              </button>
            ) : (
              <span className="dg-line">{line.text}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function BriefSkeleton() {
  return (
    <div className="dg-skel" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

interface BriefPanelProps {
  brief: Brief;
  entries: readonly BriefEntry[];
  flagged: number;
  quiet: boolean;
  voice: Voice;
  now: number;
  onEntry: (entry: BriefEntry) => void;
  onOpenChat: (id: string) => void;
}

function readyMeta(digest: Digest, quiet: boolean, newActivity: boolean, voice: Voice): string {
  const parts = [quiet ? nothingFlagged(voice) : null, digestMeta(digest)];
  if (!newActivity) parts.push('Nothing new since then');
  return parts.filter(Boolean).join(' · ');
}

export function BriefPanel(props: BriefPanelProps) {
  const { brief, entries, quiet, voice, now } = props;
  const [auditOpen, setAuditOpen] = useState(false);
  const current = brief.current;
  if (!brief.available) return null;
  if (!brief.enabled) {
    return (
      <p className="dg-off">
        <BlobScout size={22} mood="sleep" />
        {briefOffLine(voice)}{' '}
        <button type="button" className="hlink" onClick={() => void brief.turnOn()}>
          Turn on (about $0.01 each)
        </button>
      </p>
    );
  }
  if (brief.view === 'loading') {
    return (
      <div className="hpanel dg" aria-hidden="true">
        <div className="dg-head">
          <span className="hsk dot" />
          <span className="hsk" style={{ width: 220 }} />
        </div>
        <BriefSkeleton />
      </div>
    );
  }
  if (brief.writing) {
    return (
      <div className="hpanel dg" aria-busy="true">
        <div className="dg-head">
          <BlobScout size={28} mood="working" />
          <p className="dg-meta" role="status">
            {writingMeta(props.flagged)}
          </p>
        </div>
        <BriefSkeleton />
        <CalendarBriefBlock now={now} />
      </div>
    );
  }
  const hint = refreshHint(brief.state, now);
  return (
    <div className="hpanel dg">
      <div className="dg-head">
        <BlobScout size={28} mood={brief.view === 'failed' ? 'sad' : quiet ? 'happy' : null} />
        <p className="dg-meta" aria-live="polite">
          {current?.status === 'ready'
            ? readyMeta(current, quiet, brief.state?.newActivity ?? false, voice)
            : current && brief.view === 'failed'
              ? `Last try ${digestMeta(current)}`
              : 'No brief yet.'}
        </p>
        {current?.conversationId && brief.view === 'ready' && (
          <button type="button" className="hlink" onClick={() => setAuditOpen(true)}>
            Audit
          </button>
        )}
      </div>
      {brief.view === 'failed' && (
        <p className="dg-error" role="status">
          <span>
            <b>Couldn’t write a new brief.</b> {current?.error ?? 'The brief could not be written.'}{' '}
            {!quiet && 'The list below is complete; only the summary is missing. '}
            {canRefresh(brief.state, now) ? (
              <button type="button" className="hlink" onClick={brief.refresh}>
                Retry
              </button>
            ) : (
              hint && <span className="dg-hint">{hint}.</span>
            )}
          </span>
        </p>
      )}
      {brief.view === 'ready' && current && (
        <>
          {current.body?.headline && <p className="dg-headline">{current.body.headline}</p>}
          <BriefItems
            entries={entries}
            label={quiet ? 'Pick up where you left off' : 'Do these first'}
            onEntry={props.onEntry}
          />
          <Away digest={current} onOpenChat={props.onOpenChat} />
        </>
      )}
      <CalendarBriefBlock now={now} />
      {brief.error && <p className="home-error">{brief.error}</p>}
      {createPortal(
        <AnimatePresence>
          {auditOpen && current?.conversationId && (
            <AuditDialog
              conversationId={current.conversationId}
              title="Brief"
              onClose={() => setAuditOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
