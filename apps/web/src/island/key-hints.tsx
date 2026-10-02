import type { ReactNode } from 'react';
import type { IslandView, Panel } from './island-model.ts';
import { Kbd } from './island-parts.tsx';

const PANEL_HINTS: Record<Panel, ReactNode> = {
  home: (
    <>
      <Kbd>⌘ 1–4</Kbd> switch · <Kbd>⌘</Kbd> click opens in Spark · <Kbd>Esc</Kbd> close
    </>
  ),
  sessions: (
    <>
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>⌘ 3</Kbd> new chat · <Kbd>Esc</Kbd> close
    </>
  ),
  quick: (
    <>
      <Kbd>Enter</Kbd> send · <Kbd>⇧ Enter</Kbd> new line · <Kbd>⌘ 2</Kbd> chats · <Kbd>Esc</Kbd>{' '}
      close
    </>
  ),
  ask: (
    <>
      <Kbd>Enter</Kbd> ask · <Kbd>⌘ 3</Kbd> new chat · <Kbd>⌘ 2</Kbd> chats · <Kbd>Esc</Kbd> close
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
    case 'pill':
      return (
        <>
          <Kbd>⌥ Space</Kbd> chat · <Kbd>⌥ ⇧ Space</Kbd> chats · <Kbd>Esc</Kbd> close
        </>
      );
    default:
      return null;
  }
}
