import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { ModelsSection } from '../models/ModelsSection.tsx';
import { ConnectorGrid } from '../onboarding/ToolsStep.tsx';
import { ProviderList } from '../providers/ProviderList.tsx';
import { ThemeCards } from '../theme/ThemeCards.tsx';
import { reveal } from '../ui/transitions.tsx';
import { UsageSection } from '../usage/UsageSection.tsx';
import { AutoContinueSetting } from './AutoContinueSetting.tsx';
import { JevDiffsSetting } from './JevDiffsSetting.tsx';
import { CompanionSetting } from './CompanionSetting.tsx';
import { ProfileSection } from './ProfileSection.tsx';
import '../onboarding/tools.css';
import './settings.css';

export type SettingsSection = 'profile' | 'ai' | 'models' | 'usage' | 'tools' | 'look';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  },
  {
    id: 'ai',
    label: 'AI providers',
    icon: <path d="M12 3 13.6 10.4 21 12l-7.4 1.6L12 21l-1.6-7.4L3 12l7.4-1.6Z" />,
  },
  {
    id: 'models',
    label: 'Models',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </>
    ),
  },
  {
    id: 'usage',
    label: 'Usage',
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    id: 'tools',
    label: 'Connectors',
    icon: <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />,
  },
  {
    id: 'look',
    label: 'Appearance',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
      </>
    ),
  },
];

interface SettingsDialogProps {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
}

export function SettingsDialog({ section, onSection, onClose }: SettingsDialogProps) {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const closeRef = useRef<HTMLButtonElement>(null);
  const connected = setup.data?.providers.filter((provider) => provider.connection).length ?? 0;
  const title = SECTIONS.find((entry) => entry.id === section)?.label ?? '';

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="set"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reveal}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
      >
        <div className="set-nav">
          <h2>Settings</h2>
          <div role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === section}
                onClick={() => onSection(entry.id)}
              >
                {entry.id === section && (
                  <motion.span
                    layoutId="set-nav-highlight"
                    className="set-nav-highlight"
                    transition={reveal}
                  />
                )}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {entry.icon}
                </svg>
                <span>{entry.label}</span>
                {entry.id === 'ai' && connected > 0 && <span className="badge">{connected}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="set-main">
          <div className="set-head">
            <h3 id="set-title">{title}</h3>
            <button
              ref={closeRef}
              type="button"
              className="icon-btn"
              aria-label="Close settings"
              onClick={onClose}
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
          </div>
          <div className="set-body" role="tabpanel" aria-labelledby="set-title">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ ...reveal, duration: 0.15 }}
              >
                {setup.data && section === 'profile' && (
                  <ProfileSection displayName={setup.data.profile.displayName} />
                )}
                {setup.data && section === 'ai' && (
                  <>
                    <p className="lede">
                      Connect Claude, Codex, or both. Open a provider to test it, sign in again, or
                      change its defaults for new chats.
                    </p>
                    <ProviderList
                      providers={setup.data.providers}
                      advisors={setup.data.advisors}
                      defaultProvider={setup.data.profile.defaultProvider}
                    />
                    <AutoContinueSetting seconds={setup.data.profile.autoContinueSeconds} />
                    <JevDiffsSetting enabled={setup.data.profile.jevDiffs} />
                  </>
                )}
                {section === 'models' && <ModelsSection />}
                {section === 'usage' && <UsageSection />}
                {section === 'tools' && (
                  <>
                    <p className="lede">
                      Connectors will let Spark read tickets, pull requests, and threads when you
                      ask it to. They aren't ready yet.
                    </p>
                    <ConnectorGrid />
                  </>
                )}
                {section === 'look' && (
                  <>
                    <p className="lede">Pick a theme. It applies everywhere right away.</p>
                    <ThemeCards />
                    <CompanionSetting />
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
