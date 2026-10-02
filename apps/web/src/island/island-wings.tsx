import type { ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { Card, IslandView, Panel } from './island-model.ts';
import { Kbd } from './island-parts.tsx';

export interface WingProps {
  view: IslandView;
  waiting: number;
  greeting: string | null;
  listing: boolean;
  followUp: ConversationSummary | null;
  onTab: (panel: Panel) => void;
  onReview: (card: Card) => void;
}

export function wingsFor(props: WingProps): { left: ReactNode; right: ReactNode } {
  const { view, waiting, greeting } = props;
  switch (view.kind) {
    case 'pill':
      return props.listing
        ? {
            left: null,
            right: (
              <>
                <button
                  type="button"
                  className="isl-pill-btn"
                  onClick={() => props.onTab('sessions')}
                >
                  See all
                </button>
                <button type="button" className="isl-pill-btn" onClick={() => props.onTab('quick')}>
                  New chat
                </button>
              </>
            ),
          }
        : {
            left: null,
            right: (
              <button type="button" className="isl-pill-btn" onClick={() => props.onTab('quick')}>
                <span>{greeting ?? 'New chat'}</span>
              </button>
            ),
          };
    case 'nudge':
      return {
        left: null,
        right: (
          <button
            type="button"
            className="isl-pill-btn isl-nudge"
            onClick={() => props.onReview(view.card)}
          >
            <span className="isl-nudge-title">{view.card.chat.title}</span>
            <span>needs you ·</span>
            <b>Review</b>
          </button>
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
