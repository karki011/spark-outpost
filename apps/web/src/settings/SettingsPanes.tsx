import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { useCalendarStatus } from '../calendar/use-calendar.ts';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../phone/use-remote-client.ts';
import { reveal } from '../ui/transitions.tsx';
import { clearSettingFocus, requestSettingFocus } from './setting-focus.ts';
import {
  SETTINGS_GROUPS,
  availableSections,
  groupTitle,
  type SettingsSection,
  type SettingsClient,
  type SettingsSectionEntry,
} from './settings-sections.tsx';
import { SettingsSearch } from './SettingsSearch.tsx';
import './settings.css';
import './settings-cards.css';

interface SettingsPanesProps {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onOpenChat: (conversationId: string) => void;
  closeButton?: ReactNode;
}

function searchable(sections: readonly SettingsSectionEntry[], client: SettingsClient) {
  return sections.map((entry) => ({
    id: entry.id,
    label: entry.label,
    groupLabel: groupTitle(entry.group),
    rows: entry.rows?.(client) ?? [],
  }));
}

export function sectionLabel(section: SettingsSection): string {
  return availableSections().find((entry) => entry.id === section)?.label ?? 'Settings';
}

export function SettingsPanes({ section, onSection, onOpenChat, closeButton }: SettingsPanesProps) {
  const phone = useRemoteClient();
  const [sections] = useState(availableSections);
  const calendar = useCalendarStatus().data?.supported === true;
  const index = useMemo(
    () => searchable(sections, { remote: phone.remote, calendar }),
    [sections, phone.remote, calendar],
  );
  const current = sections.find((entry) => entry.id === section);
  const gate = current?.remoteSwitch;
  const off = gate !== undefined && !phone.allows(gate);
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const [query, setQuery] = useState('');
  const connected = setup.data?.providers.filter((provider) => provider.connection).length ?? 0;
  const title = current?.label ?? '';

  const openSection = (next: SettingsSection) => {
    clearSettingFocus();
    onSection(next);
  };

  return (
    <>
      <div className="set-nav">
        <h2>Settings</h2>
        <SettingsSearch
          sections={index}
          query={query}
          onQuery={setQuery}
          onChoose={(match) => {
            if (match.row) requestSettingFocus(match.row);
            else clearSettingFocus();
            onSection(match.section);
          }}
        />
        {query.trim() === '' && (
          <div role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            {SETTINGS_GROUPS.map((group) => {
              const entries = sections.filter((entry) => entry.group === group.id);
              if (entries.length === 0) return null;
              const groupId = `set-group-${group.id}`;
              return (
                <Fragment key={group.id}>
                  <span id={groupId} className="set-nav-group" aria-hidden="true">
                    {group.title}
                  </span>
                  {entries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      aria-selected={entry.id === section}
                      aria-describedby={groupId}
                      onClick={() => openSection(entry.id)}
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
                      {entry.id === 'ai' && connected > 0 && (
                        <span className="badge">{connected}</span>
                      )}
                    </button>
                  ))}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
      <div className="set-main">
        <div className="set-head">
          <h3 id="set-title">{title}</h3>
          {closeButton}
        </div>
        <div className="set-body" role="tabpanel" aria-labelledby="set-title">
          {off && (
            <p className="set-off-note" role="note">
              {PHONE_SWITCH_OFF}
            </p>
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              className={off ? 'set-off' : undefined}
              inert={off}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ ...reveal, duration: 0.15 }}
            >
              {current?.render({ setup: setup.data, off, onOpenChat })}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
