import type { ReactNode } from 'react';
import { defaultIslandShortcuts, shortcutLabel } from '../desktop/shortcut-keys.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import { shortcutText } from '../ui/shortcuts.ts';
import type { IslandView, Panel } from './island-model.ts';
import { Kbd } from './island-parts.tsx';

function keys(parts: readonly string[]): string {
  return shortcutText(parts, undefined, ' ');
}

function panelHint(panel: Panel): ReactNode {
  switch (panel) {
    case 'home':
      return (
        <>
          <Kbd>Y</Kbd> / <Kbd>N</Kbd> answer · <Kbd>{keys(['mod', 'J'])}</Kbd> join ·{' '}
          <Kbd>{keys(['mod', 'O'])}</Kbd> open Spark · <Kbd>Esc</Kbd> close
        </>
      );
    case 'quick':
      return (
        <>
          <Kbd>Enter</Kbd> send · <Kbd>{keys(['shift', 'Enter'])}</Kbd> new line ·{' '}
          <Kbd>{keys(['mod', '1'])}</Kbd> home · <Kbd>Esc</Kbd> close
        </>
      );
    case 'ask':
      return (
        <>
          <Kbd>Enter</Kbd> ask · <Kbd>{keys(['mod', '2'])}</Kbd> new chat ·{' '}
          <Kbd>{keys(['mod', '1'])}</Kbd> home · <Kbd>Esc</Kbd> close
        </>
      );
  }
}

export function useQuickKeys(): string {
  const quick = useCompanionStatus()?.shortcuts.quick ?? defaultIslandShortcuts().quick;
  return shortcutLabel(quick);
}

export function keyHint(view: IslandView, quickKeys: string): ReactNode {
  switch (view.kind) {
    case 'panel':
      return panelHint(view.panel);
    case 'card':
      return view.card.kind === 'approval' ? (
        <>
          <Kbd>{quickKeys}</Kbd> focus card · <Kbd>Y</Kbd> allow · <Kbd>N</Kbd> deny
        </>
      ) : view.card.kind === 'force' ? (
        <>
          <Kbd>{quickKeys}</Kbd> focus card · <Kbd>N</Kbd> deny · hold the button to confirm
        </>
      ) : null;
    default:
      return null;
  }
}
