import { useState } from 'react';
import {
  parseBrowserUrl,
  type BrowserProfile,
  type BrowserViewLayout,
} from '@spark-outpost/contracts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { ArchiveIcon, ChevronIcon, RestoreIcon } from '../ui/icons.tsx';
import { sendViewCommand } from './view-store.ts';

export function ViewArchived({
  profile,
  layout,
}: {
  profile: BrowserProfile;
  layout: BrowserViewLayout;
}) {
  const [open, setOpen] = useState(false);
  const { archived } = layout;
  if (archived.length === 0) return null;
  return (
    <section className="bv-section" aria-label="Archived tabs">
      <button
        type="button"
        className="bv-row bv-folder-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={open ? 'bv-folder-chev' : 'bv-folder-chev shut'}>
          <ChevronIcon />
        </span>
        <ArchiveIcon />
        <span className="bv-tab-title">Archived</span>
        <span className="bv-folder-count">{archived.length}</span>
      </button>
      {open && (
        <>
          <ul className="bv-tabs bv-archived" aria-label="Archived tabs">
            {archived.map((tab) => {
              const name = tab.title.trim() || parseBrowserUrl(tab.url)?.host || tab.url;
              return (
                <li key={tab.id} className="bv-tab">
                  <button
                    type="button"
                    className="bv-row bv-tab-main"
                    aria-label={`Reopen ${name}`}
                    title={tab.url}
                    onClick={() =>
                      sendViewCommand(profile, { command: 'archived_open', id: tab.id })
                    }
                  >
                    <span className="bv-tile" aria-hidden="true">
                      <RestoreIcon />
                    </span>
                    <span className="bv-tab-title">{name}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn bv-tab-x"
                    aria-label={`Remove ${name} from Archived`}
                    onClick={() =>
                      sendViewCommand(profile, { command: 'archived_remove', id: tab.id })
                    }
                  >
                    <CloseIcon />
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="bv-row bv-new"
            onClick={() => sendViewCommand(profile, { command: 'archived_clear' })}
          >
            Clear Archived
          </button>
        </>
      )}
    </section>
  );
}
