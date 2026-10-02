import type { ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { IslandView, Panel } from './island-model.ts';
import { Kbd, RunDots } from './island-parts.tsx';
import type { WorkItem } from './WorkViews.tsx';

export interface WingProps {
  view: IslandView;
  waiting: number;
  greeting: string | null;
  workItems: WorkItem[];
  watch: { id: string; tag: string } | null;
  followUp: ConversationSummary | null;
  onTab: (panel: Panel) => void;
}

export function wingsFor(props: WingProps): { left: ReactNode; right: ReactNode } {
  const { view, waiting, greeting, workItems } = props;
  switch (view.kind) {
    case 'pill':
      return {
        left: null,
        right: (
          <button
            type="button"
            className="isl-pill-btn"
            onClick={() => props.onTab(waiting > 0 ? 'sessions' : 'quick')}
          >
            {greeting ? (
              <span>{greeting}</span>
            ) : waiting > 0 ? (
              <>
                <span className="isl-badge">{waiting}</span>
                <span>need you</span>
              </>
            ) : (
              <span>New chat</span>
            )}
          </button>
        ),
      };
    case 'live': {
      const crew = workItems.flatMap((item) =>
        item.agent.crew.filter((agent) => agent.state === 'working' || agent.state === 'thinking'),
      );
      return {
        left: null,
        right:
          crew.length > 1 ? (
            <>
              <span className="isl-crew" aria-hidden="true">
                {crew.slice(0, 4).map((agent) => (
                  <span key={agent.id} className="isl-cb" title={agent.name}>
                    <CrewBlob
                      name={agent.name}
                      provider={agent.provider}
                      state={agent.state}
                      size={18}
                    />
                  </span>
                ))}
              </span>
              <span>{crew.length}</span>
            </>
          ) : (
            <>
              <RunDots />
              <span>{workItems.length}</span>
            </>
          ),
      };
    }
    case 'overview':
      return {
        left: 'Spark',
        right: (
          <>
            <RunDots />
            <span>{workItems.length} running</span>
          </>
        ),
      };
    case 'card':
      return {
        left: view.card.kind === 'question' ? 'Question' : 'Needs you',
        right:
          view.card.kind === 'force' ? (
            <>
              <span className="isl-badge bad">!</span>
              <span>Risky</span>
            </>
          ) : (
            <>
              <span className="isl-badge">{view.index}</span>
              <span>of {view.total}</span>
            </>
          ),
      };
    case 'moment':
      return {
        left:
          props.watch?.id === view.moment.chatId
            ? 'Reply'
            : view.moment.kind === 'done'
              ? 'Finished'
              : 'Couldn’t finish',
        right: (
          <span className={view.moment.kind === 'done' ? 'isl-badge ok' : 'isl-badge bad'}>
            {view.moment.kind === 'done' ? '✓' : '!'}
          </span>
        ),
      };
    case 'panel':
      return {
        left:
          view.panel === 'quick'
            ? props.followUp
              ? 'Reply'
              : 'New chat'
            : view.panel === 'sessions'
              ? 'Sessions'
              : 'Ask Spark',
        right:
          view.panel === 'sessions' && waiting > 0 ? (
            <>
              <span className="isl-badge">{waiting}</span>
              <span>need you</span>
            </>
          ) : (
            <Kbd>⌥ Space</Kbd>
          ),
      };
    default:
      return { left: null, right: null };
  }
}
