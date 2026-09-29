import type { ConversationSummary } from '@spark-outpost/contracts';
import type { Voice } from '../spark/voice.ts';
import { canRefresh, refreshHint } from './digest-model.ts';
import { BriefPanel, BriefSkeleton } from './BriefPanel.tsx';
import { NeedsFeed } from './NeedsFeed.tsx';
import type { BriefEntry, FeedRow, NeedsMode } from './needs-model.ts';
import type { Brief } from './use-brief.ts';

interface NeedsTodayProps {
  mode: NeedsMode;
  brief: Brief;
  rows: readonly FeedRow[];
  entries: readonly BriefEntry[];
  connectHint: boolean;
  voice: Voice;
  now: number;
  onOpen: (chat: ConversationSummary) => void;
  onOpenId: (id: string) => void;
  onEntry: (entry: BriefEntry) => void;
  onConnect: () => void;
  onDismissHint: () => void;
}

function RefreshButton({ brief, now }: { brief: Brief; now: number }) {
  if (!brief.available) return null;
  const ready = brief.enabled && !brief.writing && canRefresh(brief.state, now);
  return (
    <button
      type="button"
      className="hlink"
      disabled={!ready}
      title={brief.writing ? undefined : (refreshHint(brief.state, now) ?? undefined)}
      onClick={brief.refresh}
    >
      {brief.writing ? 'Writing…' : 'Refresh'}
    </button>
  );
}

function FeedSkeleton() {
  return (
    <ul className="lrows sk-rows" aria-hidden="true">
      {[62, 48, 70, 54].map((width) => (
        <li key={width} className="lrow">
          <span className="lr-main">
            <span className="hsk dot" />
            <span className="hsk" style={{ width: `${width}%` }} />
            <span className="hsk" style={{ width: 120 }} />
            <span className="hsk" style={{ width: 24 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NeedsToday(props: NeedsTodayProps) {
  const { mode, brief, rows, now } = props;
  if (mode === 'hidden') return null;
  const quiet = mode === 'pickup';
  if (mode === 'loading') {
    return (
      <section
        className="hsec hneeds"
        id="home-needs"
        aria-labelledby="home-needs-h"
        aria-busy="true"
      >
        <div className="hsec-h">
          <h2 id="home-needs-h">What needs you today</h2>
        </div>
        <p className="sr-only" role="status">
          Loading what needs you
        </p>
        <div className="hpanel dg" aria-hidden="true">
          <div className="dg-head">
            <span className="hsk dot" />
            <span className="hsk" style={{ width: 220 }} />
          </div>
          <BriefSkeleton />
        </div>
        <FeedSkeleton />
      </section>
    );
  }
  return (
    <section className="hsec hneeds" id="home-needs" aria-labelledby="home-needs-h">
      <div className="hsec-h">
        <h2 id="home-needs-h">
          {quiet ? 'Pick up where you left off' : 'What needs you today'}
          {!quiet && (
            <>
              {' '}
              <span className="n">{rows.length}</span>
            </>
          )}
        </h2>
        <RefreshButton brief={brief} now={now} />
      </div>
      <BriefPanel
        brief={brief}
        entries={props.entries}
        flagged={rows.length}
        quiet={quiet}
        voice={props.voice}
        now={now}
        onEntry={props.onEntry}
        onOpenChat={props.onOpenId}
      />
      {!quiet && (
        <NeedsFeed
          rows={rows}
          connectHint={props.connectHint}
          onOpen={props.onOpen}
          onConnect={props.onConnect}
          onDismissHint={props.onDismissHint}
        />
      )}
    </section>
  );
}
