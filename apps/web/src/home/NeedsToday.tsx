import type { ConversationSummary } from '@spark-outpost/contracts';
import type { Voice } from '../spark/voice.ts';
import { InfoTip } from '../ui/InfoTip.tsx';
import { canRefresh, refreshHint } from './digest-model.ts';
import { BriefPanel } from './BriefPanel.tsx';
import { HomeCard, Quiet, RowsSkeleton } from './HomeCards.tsx';
import { ConnectHint, NeedsFeed, SORT_RULE } from './NeedsFeed.tsx';
import type { NeedsColumn } from './board-model.ts';
import type { BriefEntry, FeedRow } from './needs-model.ts';
import type { Brief } from './use-brief.ts';

interface NeedsTodayProps {
  mode: NeedsColumn;
  loading: boolean;
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

export function NeedsToday(props: NeedsTodayProps) {
  const { mode, brief, rows, now } = props;
  const needs = mode === 'needs';
  if (props.loading) {
    return (
      <HomeCard id="home-needs-h" title="Needs you" className="hneeds" busy>
        <RowsSkeleton />
      </HomeCard>
    );
  }
  return (
    <HomeCard
      id="home-needs-h"
      title={needs ? 'Needs you' : 'Pick up next'}
      count={needs ? rows.length : undefined}
      className="hneeds"
      action={
        <span className="hday-a">
          {needs && <InfoTip topic="how this list is sorted" text={SORT_RULE} />}
          <RefreshButton brief={brief} now={now} />
        </span>
      }
    >
      {needs && <NeedsFeed rows={rows} onOpen={props.onOpen} />}
      {brief.available ? (
        <BriefPanel
          brief={brief}
          entries={props.entries}
          flagged={rows.length}
          quiet={!needs}
          voice={props.voice}
          now={now}
          onEntry={props.onEntry}
          onOpenChat={props.onOpenId}
        />
      ) : (
        !needs && <Quiet>Nothing to pick up yet.</Quiet>
      )}
      {props.connectHint && (
        <ConnectHint onConnect={props.onConnect} onDismiss={props.onDismissHint} />
      )}
    </HomeCard>
  );
}
