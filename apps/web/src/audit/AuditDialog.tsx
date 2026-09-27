import '../settings/settings.css';
import './audit.css';
import './audit-views.css';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { reveal } from '../ui/transitions.tsx';
import { auditApi, auditKeys } from './audit-api.ts';
import { AuditExport } from './AuditExport.tsx';
import { AuditLogs } from './AuditLogs.tsx';
import { AuditSummaryPane } from './AuditSummaryPane.tsx';
import { AuditTimeline } from './AuditTimeline.tsx';
import { ChainBadge, useChainChecks } from './ChainBadge.tsx';

export type AuditTab = 'summary' | 'timeline' | 'logs' | 'export';

const TABS: { id: AuditTab; label: string; path: string }[] = [
  { id: 'summary', label: 'Summary', path: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'timeline', label: 'Timeline', path: 'M3 6h9M7 12h11M5 18h7' },
  { id: 'logs', label: 'Logs', path: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  { id: 'export', label: 'Export', path: 'M12 4v12M7 11l5 5 5-5M5 20h14' },
];

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface AuditDialogProps {
  conversationId: string;
  title: string;
  onClose(): void;
}

function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function TabIcon({ path }: { path: string }): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function AuditDialog({ conversationId, title, onClose }: AuditDialogProps) {
  const [tab, setTab] = useState<AuditTab>('summary');
  const closeRef = useRef<HTMLButtonElement>(null);
  const summary = useQuery({
    queryKey: auditKeys.summary(conversationId),
    queryFn: () => auditApi.summary(conversationId),
  });
  const runs = summary.data?.runs ?? [];
  const checks = useChainChecks(runs);
  const label = TABS.find((entry) => entry.id === tab)!.label;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
    };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(index + step + TABS.length) % TABS.length]!.id;
    setTab(next);
    document.getElementById(`aud-tab-${next}`)?.focus();
  };

  return (
    <motion.div
      className="set aud-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reveal}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        className="set-panel aud"
        role="dialog"
        aria-modal="true"
        aria-label="Audit this chat"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={reveal}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          trapFocus(event);
        }}
      >
        <div className="set-nav">
          <h2>Audit</h2>
          <div role="tablist" aria-label="Audit views" aria-orientation="vertical">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                id={`aud-tab-${entry.id}`}
                type="button"
                role="tab"
                aria-selected={entry.id === tab}
                aria-controls="aud-body"
                tabIndex={entry.id === tab ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={onTabKey}
              >
                {entry.id === tab && <span className="set-nav-highlight" />}
                <TabIcon path={entry.path} />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="set-main">
          <div className="set-head">
            <h3 id="aud-title">
              {label}
              <small>{title}</small>
            </h3>
            <ChainBadge runs={runs} checks={checks} />
            <button
              ref={closeRef}
              type="button"
              className="icon-btn"
              aria-label="Close audit"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          <div
            className="set-body"
            id="aud-body"
            role="tabpanel"
            aria-labelledby={`aud-tab-${tab}`}
          >
            {summary.isError && <p className="aud-empty">{summary.error.message}</p>}
            {!summary.data && !summary.isError && <p className="aud-empty">Loading…</p>}
            {summary.data && (
              <div key={tab} className="aud-pane">
                {tab === 'summary' && <AuditSummaryPane summary={summary.data} />}
                {tab === 'timeline' && <AuditTimeline runs={runs} />}
                {tab === 'logs' && <AuditLogs runs={runs} checks={checks} />}
                {tab === 'export' && (
                  <AuditExport conversationId={conversationId} summary={summary.data} />
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
