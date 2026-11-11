import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { DocLink } from '../ui/DocLink.tsx';
import { fullDiskAccessQuery } from './full-disk-access-status.ts';
import { isPromptSilenced, silencePrompt } from './full-disk-access-prompt-storage.ts';
import { useOpenFullDiskAccess } from './use-open-full-disk-access.ts';
import './full-disk-access-prompt.css';

export function FullDiskAccessPrompt() {
  const { remote } = useRemoteClient();
  const eligible = Boolean(sparkDesktop()?.privacy) && !remote;
  const status = useQuery({ ...fullDiskAccessQuery, enabled: eligible }).data?.status;
  const [hiddenForSession, setHiddenForSession] = useState(false);
  const [silenced, setSilenced] = useState(isPromptSilenced);
  const openSystemSettings = useOpenFullDiskAccess();

  if (!eligible || status !== 'not_granted' || hiddenForSession || silenced) return null;

  return (
    <section className="fda-prompt" role="status" aria-label="Full Disk Access">
      <div className="fda-prompt-head">
        <b>Let agents read protected folders?</b>
        <DocLink
          topic="Full Disk Access"
          doc={{ page: 'mac-privacy', heading: 'full-disk-access' }}
        />
      </div>
      <p>
        Without Full Disk Access, macOS asks each time an agent reads Desktop, Documents, Downloads
        or ~/Library. Optional; Spark works without it.
      </p>
      <div className="fda-prompt-actions">
        <button type="button" className="btn primary sm" onClick={() => void openSystemSettings()}>
          Open System Settings
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setHiddenForSession(true)}>
          Not now
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            silencePrompt();
            setSilenced(true);
          }}
        >
          Don't ask again
        </button>
      </div>
    </section>
  );
}
