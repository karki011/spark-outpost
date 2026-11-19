import './health.css';
import { useId } from 'react';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { CheckIcon, InfoIcon, SpinnerIcon, WarnIcon } from '../../ui/icons.tsx';
import { requestSettingFocus } from '../setting-focus.ts';
import { requestSettings } from '../settings-request.ts';
import { healthSummary } from './health-summary.ts';
import type { HealthFix, HealthItem } from './health-model.ts';
import { useHealth, type HealthSource } from './use-health.ts';

interface OpenChat {
  onOpenChat: (conversationId: string) => void;
}

function FixAction({ fix, onOpenChat }: { fix: HealthFix } & OpenChat) {
  if (fix.kind === 'note') return <p className="health-note">{fix.text}</p>;
  const open = () => {
    if (fix.kind === 'chat') {
      onOpenChat(fix.conversationId);
      return;
    }
    if (fix.focus) requestSettingFocus(fix.focus);
    requestSettings(fix.section);
  };
  return (
    <button type="button" className="btn line sm health-fix" onClick={open}>
      {fix.label}
    </button>
  );
}

function StatusWord({ status }: { status: HealthItem['status'] }) {
  return (
    <span className="health-status" data-status={status}>
      {status === 'broken' ? <WarnIcon /> : <InfoIcon />}
      {status === 'broken' ? 'Broken' : 'Ignored'}
    </span>
  );
}

function HealthRow({ item, onOpenChat }: { item: HealthItem } & OpenChat) {
  return (
    <li className="health-item">
      <StatusWord status={item.status} />
      <div className="health-text">
        <b>{item.title}</b>
        {item.detail && <small>{item.detail}</small>}
      </div>
      <FixAction fix={item.fix} onOpenChat={onOpenChat} />
    </li>
  );
}

function SourceBlock({ source, onOpenChat }: { source: HealthSource } & OpenChat) {
  const titleId = useId();
  return (
    <section className="health-source" aria-labelledby={titleId}>
      <h4 id={titleId}>{source.label}</h4>
      {source.state === 'checking' && <p className="set-hint">Checking…</p>}
      {source.state === 'failed' && (
        <p className="set-hint" role="alert">
          Couldn’t check {source.label.toLowerCase()}. Spark tries again when you come back.
        </p>
      )}
      {source.items.length > 0 && (
        <ul aria-label={source.label}>
          {source.items.map((item) => (
            <HealthRow key={item.key} item={item} onOpenChat={onOpenChat} />
          ))}
        </ul>
      )}
    </section>
  );
}

const SUMMARY_ICONS = {
  fine: <CheckIcon />,
  checking: <SpinnerIcon />,
  unchecked: <InfoIcon />,
  problems: <WarnIcon />,
};

function SummaryLine({ sources }: { sources: readonly HealthSource[] }) {
  const summary = healthSummary(sources);
  return (
    <p className="health-summary" data-kind={summary.kind} role="status">
      {SUMMARY_ICONS[summary.kind]}
      <span>{summary.text}</span>
    </p>
  );
}

function HealthReport({ onOpenChat }: OpenChat) {
  const sources = useHealth();
  const shown = sources.filter((source) => source.state !== 'ready' || source.items.length > 0);
  return (
    <>
      <SummaryLine sources={sources} />
      {shown.map((source) => (
        <SourceBlock key={source.id} source={source} onOpenChat={onOpenChat} />
      ))}
    </>
  );
}

export function HealthSection({ onOpenChat }: OpenChat) {
  const { remote } = useRemoteClient();
  return (
    <>
      <p className="lede">
        What’s broken or quietly ignored: rules, repo settings, plugins, Terminal mods, failed
        turns, sign-ins and helpers, each with where to fix it.
      </p>
      {remote ? (
        <p className="set-hint">Health is on your Mac.</p>
      ) : (
        <HealthReport onOpenChat={onOpenChat} />
      )}
    </>
  );
}
