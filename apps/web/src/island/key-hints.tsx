import type { ReactNode } from 'react';
import type { IslandView } from './island-model.ts';
import { Kbd } from './island-parts.tsx';

export function keyHint(view: IslandView): ReactNode {
  switch (view.kind) {
    case 'panel':
      return view.panel === 'sessions' ? (
        <>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>⌘ 1</Kbd> chat · <Kbd>⌘ 3</Kbd> ask ·{' '}
          <Kbd>Esc</Kbd> close
        </>
      ) : view.panel === 'quick' ? (
        <>
          <Kbd>Enter</Kbd> send · <Kbd>⇧ Enter</Kbd> new line · <Kbd>⌘ 2</Kbd> sessions ·{' '}
          <Kbd>Esc</Kbd> close
        </>
      ) : (
        <>
          <Kbd>Enter</Kbd> ask · <Kbd>⌘ 1</Kbd> chat · <Kbd>⌘ 2</Kbd> sessions · <Kbd>Esc</Kbd>{' '}
          close
        </>
      );
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
          <Kbd>⌥ Space</Kbd> chat · <Kbd>⌥ ⇧ Space</Kbd> sessions · <Kbd>Esc</Kbd> close
        </>
      );
    default:
      return null;
  }
}
