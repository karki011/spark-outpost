import type { ReactNode } from 'react';
import type { IslandView, Panel } from './island-model.ts';
import { Kbd } from './island-parts.tsx';

export interface WingProps {
  view: IslandView;
  waiting: number;
  greeting: string | null;
  followUp: { title: string } | null;
  hugsNotch: boolean;
  onTab: (panel: Panel) => void;
}

const PANEL_LABELS: Record<Panel, string> = {
  home: 'Spark',
  quick: 'New chat',
  ask: 'Ask Spark',
};

function panelLabel(panel: Panel, followUp: boolean): string {
  return panel === 'quick' && followUp ? 'Reply' : PANEL_LABELS[panel];
}

export function wingsFor(props: WingProps): { left: ReactNode; right: ReactNode } {
  const { view, waiting, greeting } = props;
  switch (view.kind) {
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
          view.panel === 'home' && greeting
            ? greeting
            : panelLabel(view.panel, props.followUp !== null),
        right: <Kbd>⌥ Space</Kbd>,
      };
    case 'now':
      return {
        left: props.hugsNotch ? null : 'Spark',
        right:
          !props.hugsNotch && waiting > 1 ? (
            <>
              <span className="isl-badge">{waiting}</span>
              <span>need you</span>
            </>
          ) : null,
      };
    default:
      return { left: null, right: null };
  }
}
