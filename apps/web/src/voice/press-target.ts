import { useEffect, useRef, type RefObject } from 'react';
import { desktopSpeech } from './speech-bridge.ts';

interface PressTarget {
  toggle(): void;
  visible(): boolean;
}

const targets: PressTarget[] = [];
let unsubscribe: (() => void) | null = null;

function onScreen(element: HTMLElement | null): boolean {
  if (!element || element.getClientRects().length === 0) return false;
  if (element.closest('[inert]')) return false;
  const dialogs = [...document.querySelectorAll('[aria-modal="true"]')];
  return dialogs.every((dialog) => dialog.contains(element));
}

function route() {
  const target = [...targets].reverse().find((each) => each.visible());
  if (target) target.toggle();
  else void desktopSpeech()?.pressIsland?.();
}

function sync() {
  const speech = desktopSpeech();
  if (!speech?.setPressTarget) return;
  if (targets.length > 0 && !unsubscribe) {
    unsubscribe = speech.onEvent((event) => {
      if (event.kind === 'press' && event.file === undefined) route();
    });
    void speech.setPressTarget(true);
  }
  if (targets.length === 0 && unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    void speech.setPressTarget(false);
  }
}

export function useVoicePressTarget(
  toggle: () => void,
  enabled: boolean,
  element: RefObject<HTMLElement | null>,
) {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    if (!enabled) return;
    const target: PressTarget = {
      toggle: () => latest.current(),
      visible: () => onScreen(element.current),
    };
    targets.push(target);
    sync();
    return () => {
      targets.splice(targets.indexOf(target), 1);
      sync();
    };
  }, [enabled, element]);
}
