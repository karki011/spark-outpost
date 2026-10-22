import { useEffect, useRef, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { reveal } from '../ui/transitions.tsx';
import { clearSettingFocus } from './setting-focus.ts';
import type { SettingsSection } from './settings-sections.tsx';
import { SettingsPanes } from './SettingsPanes.tsx';

export type { SettingsSection } from './settings-sections.tsx';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

function tabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.closest('[inert]') === null && element.getClientRects().length > 0,
  );
}

interface SettingsDialogProps {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
  onOpenChat: (conversationId: string) => void;
}

export function SettingsDialog({ section, onSection, onClose, onOpenChat }: SettingsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    clearSettingFocus();
    onClose();
  };
  const onCloseRef = useRef(close);

  useEffect(() => {
    onCloseRef.current = close;
  });

  useEffect(() => {
    const panel = closeRef.current?.closest('.set-panel');
    if (!panel?.contains(document.activeElement)) closeRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const panel = event.currentTarget;
    if (event.key === 'Tab' && !panel.contains(document.activeElement)) {
      event.preventDefault();
      closeRef.current?.focus();
      return;
    }
    wrapTabFocus(event, () => tabStops(panel));
  };

  return (
    <motion.div
      className="set"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reveal}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <motion.div
        className="set-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={reveal}
        onKeyDown={trapTab}
      >
        <SettingsPanes
          section={section}
          onSection={onSection}
          onOpenChat={onOpenChat}
          closeButton={
            <button
              ref={closeRef}
              type="button"
              className="icon-btn"
              aria-label="Close settings"
              onClick={close}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          }
        />
      </motion.div>
    </motion.div>
  );
}
