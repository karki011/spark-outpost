import type { CalloutKind } from '@spark-outpost/contracts';
import { useId, useState } from 'react';
import { CheckIcon, ChevronIcon, PauseIcon } from '../../ui/icons.tsx';
import { clockText } from '../status/status-text.ts';
import { useNow } from '../status/use-status-line.ts';
import type { Callout } from './callouts.ts';
import { RowIcon, type RowIconName } from './RowIcon.tsx';
import { FailedWord, Spinner } from './RowStatus.tsx';
import { spanSeconds, type ToolItem } from './turn-rows.ts';

const CALLOUT_ICONS: Record<CalloutKind, RowIconName> = {
  browser: 'browser',
  web: 'web',
  page: 'page',
  mac: 'mac',
};

interface CalloutRowProps {
  item: ToolItem;
  callout: Callout;
  working: boolean;
}

function LiveTime({ since }: { since: number | undefined }) {
  const now = useNow(true);
  if (since === undefined) return null;
  return <span className="trow-time">{clockText(Math.max(0, now - since))}</span>;
}

function CalloutStatus({ item, live }: { item: ToolItem; live: boolean }) {
  if (item.status === 'failed') return <FailedWord />;
  if (live) return <LiveTime since={item.startedAt} />;
  if (item.status === 'open') return null;
  const seconds = spanSeconds([item]);
  return seconds ? <span className="trow-time">{seconds}s</span> : null;
}

function statusWord(item: ToolItem, live: boolean) {
  if (item.status === 'failed') return <FailedWord word="Failed" />;
  if (item.status === 'open' && live) {
    return (
      <span className="trow-word">
        <Spinner />
        Running
      </span>
    );
  }
  if (item.status === 'open') {
    return (
      <span className="trow-word">
        <PauseIcon />
        Stopped
      </span>
    );
  }
  return (
    <span className="trow-word ok">
      <CheckIcon className="ok" />
      Done
    </span>
  );
}

function CalloutFacts({
  item,
  callout,
  live,
}: Omit<CalloutRowProps, 'working'> & { live: boolean }) {
  const seconds = item.status === 'open' ? null : spanSeconds([item]);
  return (
    <dl className="trow-facts">
      <div>
        <dt>Step</dt>
        <dd>{item.target ? `${item.verb} ${item.target}` : item.verb}</dd>
      </div>
      <div>
        <dt>Tool</dt>
        <dd>
          <code>{callout.tool}</code>
        </dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{statusWord(item, live)}</dd>
      </div>
      {seconds && (
        <div>
          <dt>Took</dt>
          <dd>{seconds}s</dd>
        </div>
      )}
    </dl>
  );
}

export function CalloutRow({ item, callout, working }: CalloutRowProps) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? item.status === 'failed';
  const id = useId();
  const live = working && item.status === 'open';
  return (
    <>
      <button
        type="button"
        className="trow trow-callout"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChoice(!open)}
      >
        {live ? <Spinner /> : <RowIcon name={CALLOUT_ICONS[callout.kind]} />}
        <span className="trow-text">
          <b>{item.verb}</b>
          {item.target && (
            <>
              {' '}
              <span className="trow-name">{item.target}</span>
            </>
          )}
        </span>
        <span className="trow-end">
          <CalloutStatus item={item} live={live} />
          <ChevronIcon />
        </span>
      </button>
      <div className="trow-card" id={id} hidden={!open}>
        {open && <CalloutFacts item={item} callout={callout} live={live} />}
      </div>
    </>
  );
}
