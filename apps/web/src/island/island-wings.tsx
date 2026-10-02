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

function lastPart(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function nudgeTitle(card: Card): string {
  const approval = card.approval;
  if (card.kind === 'force') return 'Approve: force-push';
  if (card.kind === 'question') return `Question: ${card.chat.title}`;
  if (approval?.payload.plan) return 'Plan ready to review';
  if (approval?.kind === 'execute' && approval.payload.command) {
    return `Approve: run ${approval.payload.command}`;
  }
  if (approval?.kind === 'edit') {
    const paths = approval.payload.paths;
    return paths.length === 1
      ? `Approve: change ${lastPart(paths[0]!)}`
      : `Approve: change ${paths.length} files`;
  }
  if (approval?.payload.checkpoint) return `${card.chat.title}: ready for you`;
  return `${card.chat.title} needs you`;
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
            <span className="isl-nudge-title">{nudgeTitle(view.card)}</span>
            <span aria-hidden="true">·</span>
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
