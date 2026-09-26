import { useId } from 'react';
import {
  advisorLabel,
  type AdvisorUsage,
  type ConversationUsage,
  type Run,
} from '@spark-outpost/contracts';
import { usePopover } from '../../ui/use-popover.ts';
import { providerName } from '../provider-name.ts';
import { ShieldIcon } from '../../ui/icons.tsx';
import { contextPercent, costTip, latestContext, usageLine } from '../../usage/format.ts';
import '../../usage/usage.css';
import { contextLevel, formatTokens } from './model-options.ts';

const RING = 50.27;

const NOTES = {
  ok: 'Plenty of room left in this chat.',
  warm: 'Getting full. Older messages may be left out of what the AI sees.',
  hot: 'Almost full. Replies can lose track of early details, so consider a new chat.',
} as const;

interface ContextRingProps {
  runs: Run[];
  provider: string | null;
  usageTotals: ConversationUsage;
  onAudit?: () => void;
}

function chatLine(totals: ConversationUsage): string | null {
  if (totals.byProvider.length === 0) return null;
  return usageLine(totals.totalTokens || null, totals.costUsd, totals.costSource);
}

function providerLine(entry: ConversationUsage['byProvider'][number]): string {
  const parts = [
    usageLine(entry.totalTokens || null, entry.costUsd, entry.costSource) ?? 'No usage reported',
  ];
  if (entry.lastContextSize !== null) {
    parts.push(`${contextPercent(entry.lastContextUsed, entry.lastContextSize)}% context`);
  }
  return parts.join(' · ');
}

function advisorLine(entry: AdvisorUsage): string {
  const calls = `${entry.calls} ${entry.calls === 1 ? 'call' : 'calls'}`;
  return [calls, usageLine(entry.inputTokens, entry.costUsd, 'estimated')].join(' · ');
}

export function ContextRing({ runs, provider, usageTotals, onAudit }: ContextRingProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const panelId = useId();
  const reading = latestContext(runs, provider);
  const used = reading?.used ?? 0;
  const size = reading?.size ?? 0;
  const percent = contextPercent(used, size);
  const level = contextLevel(percent);
  const label = reading
    ? `Context window: ${percent}% used, ${formatTokens(used)} of ${formatTokens(size)} tokens`
    : 'Context window: no usage reported yet';
  const chat = chatLine(usageTotals);
  const showProviders = usageTotals.byProvider.length > 1;

  return (
    <div className="ctxwrap">
      <button
        ref={anchorRef}
        type="button"
        className="ctxbtn"
        data-level={level}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={chat ? `${label}\nThis chat: ${chat}` : label}
        onClick={toggle}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" className="ring-bg" />
          <circle
            cx="10"
            cy="10"
            r="8"
            className="ring-fg"
            style={{ strokeDashoffset: RING * (1 - Math.max(percent, reading ? 2 : 0) / 100) }}
          />
        </svg>
        <span className="ctxpct">{percent}%</span>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop ctxpop open' : 'mpop ctxpop'}
        role="dialog"
        aria-label="Context window"
      >
        <div className="ctx-h">
          <b>Context window</b>
          <span>
            {reading
              ? `${formatTokens(used)} of ${formatTokens(size)} tokens (${percent}%)`
              : 'No data yet'}
          </span>
        </div>
        <div className="ctx-bar" role="img" aria-label={`${percent}% of the context window used`}>
          <i style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
        <div className="ctx-legend">
          <div>
            <i className="used" />
            <span>Used by the last reply</span>
            <b>{formatTokens(used)}</b>
          </div>
          <div className="free">
            <i />
            <span>Free</span>
            <b>{formatTokens(Math.max(0, size - used))}</b>
          </div>
        </div>
        <p className={`ctx-note ${level}`}>
          {reading ? NOTES[level] : 'Send a message to see how much of the context window it uses.'}
        </p>
        {chat && (
          <div className="ctx-usage">
            <div title={costTip(usageTotals.costSource)}>
              <span>This chat</span>
              <b>{chat}</b>
            </div>
            {showProviders &&
              usageTotals.byProvider.map((entry) => (
                <div key={entry.provider} title={costTip(entry.costSource)}>
                  <span>{providerName(entry.provider)}</span>
                  <b>{providerLine(entry)}</b>
                </div>
              ))}
            {usageTotals.advisors?.map((entry) => (
              <div key={entry.advisor}>
                <span>{advisorLabel(entry.advisor)}</span>
                <b>{advisorLine(entry)}</b>
              </div>
            ))}
          </div>
        )}
        {onAudit && (
          <button
            type="button"
            className="btn ghost sm ctx-audit"
            onClick={() => {
              setOpen(false);
              anchorRef.current?.focus();
              onAudit();
            }}
          >
            <ShieldIcon />
            Audit this chat
          </button>
        )}
      </div>
    </div>
  );
}
