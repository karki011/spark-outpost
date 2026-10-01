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
import { SparkSection } from '../spark/SparkSection.tsx';
import { JevSettings } from './JevSettings.tsx';
import { ProjectsSection } from './ProjectsSection.tsx';
import { ResetSection } from '../reset/ResetSection.tsx';
import { McpSection } from './mcp/McpSection.tsx';
import { UpdatesSection, updatesAvailable } from './UpdatesSection.tsx';
import './settings.css';

export type SettingsSection =
  'spark' | 'ai' | 'models' | 'usage' | 'projects' | 'tools' | 'mcp' | 'look' | 'updates' | 'reset';

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  {
    id: 'spark',
    label: 'Spark',
    icon: (
      <>
        <path d="M4 15.5C4 11 7.4 8.5 12 8.5s8 2.5 8 7-3.4 5.5-8 5.5-8-1-8-5.5Z" />
        <path d="M13.5 8.5c.4-2 1.6-3.3 3.5-3.7" />
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
    id: 'projects',
    label: 'Projects',
    icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  },
  {
    id: 'tools',
    label: 'Connectors',
    icon: <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />,
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="6" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
        <path d="M7 7h.01M7 17h.01" />
      </>
    ),
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
  {
    id: 'updates',
    label: 'Updates',
    icon: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5M12 8v5l3 2" />
      </>
    ),
  },
  {
    id: 'reset',
    label: 'Reset',
    icon: <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5" />,
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
  const sections = SECTIONS.filter((entry) => entry.id !== 'updates' || updatesAvailable());
  const title = sections.find((entry) => entry.id === section)?.label ?? '';

  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
            {sections.map((entry) => (
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
                {setup.data && section === 'spark' && <SparkSection setup={setup.data} />}
                {setup.data && section === 'ai' && (
                  <>
                    <p className="lede">
                      Connect Claude, Codex or both. Open one to test it or change its defaults.
                    </p>
                    <ProviderList
                      providers={setup.data.providers}
                      advisors={setup.data.advisors}
                      defaultProvider={setup.data.profile.defaultProvider}
                      advisorSettings={
                        <JevSettings
                          profile={setup.data.profile}
                          jevConnected={setup.data.advisors.some(
                            (advisor) => advisor.id === 'jev' && advisor.connection,
                          )}
                        />
                      }
                    />
                  </>
                )}
                {section === 'models' && <ModelsSection />}
                {section === 'usage' && <UsageSection />}
                {section === 'projects' && <ProjectsSection />}
                {section === 'tools' && (
                  <>
                    <p className="lede">
                      GitHub lets Ship open draft pull requests. Jira and Linear bring your tickets
                      into Spark. Slack isn't ready yet.
                    </p>
                    <ConnectorGrid />
                  </>
                )}
                {section === 'mcp' && <McpSection />}
                {section === 'look' && (
                  <>
                    <p className="lede">Pick a theme. It applies everywhere right away.</p>
                    <ThemeCards />
                  </>
                )}
                {section === 'updates' && updatesAvailable() && <UpdatesSection />}
                {section === 'reset' && <ResetSection />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
