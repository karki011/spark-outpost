import type { ReactNode } from 'react';
import type { IslandView, Panel } from './island-model.ts';
import { Kbd } from './island-parts.tsx';

const PANEL_HINTS: Record<Panel, ReactNode> = {
  home: (
    <>
      Click a row to open it in Spark · <Kbd>Y</Kbd> / <Kbd>N</Kbd> answer the top card ·{' '}
      <Kbd>Esc</Kbd> close
    </>
  ),
  quick: (
    <>
      <Kbd>Enter</Kbd> send · <Kbd>⇧ Enter</Kbd> new line · <Kbd>⌘ 1</Kbd> inbox · <Kbd>Esc</Kbd>{' '}
      close
    </>
  ),
  ask: (
    <>
      <Kbd>Enter</Kbd> ask · <Kbd>⌘ 2</Kbd> new chat · <Kbd>⌘ 1</Kbd> inbox · <Kbd>Esc</Kbd> close
    </>
  ),
};

export function keyHint(view: IslandView): ReactNode {
  switch (view.kind) {
    case 'panel':
      return PANEL_HINTS[view.panel];
    case 'card':
      return view.card.kind === 'approval' ? (
        <>
          <Kbd>⌥ Space</Kbd> focus card · <Kbd>Y</Kbd> allow · <Kbd>N</Kbd> deny
        </>
      ) : view.card.kind === 'force' ? (
        <>
          <Kbd>⌥ Space</Kbd> focus card · <Kbd>N</Kbd> deny · hold the button to confirm
        </>
      ) : null;
    default:
      return null;
  }
}
