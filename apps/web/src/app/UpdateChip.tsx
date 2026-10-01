import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { useInstallUpdate } from '../desktop/use-install-update.ts';
import { useUpdateStatus } from '../desktop/use-update-status.ts';
import '../desktop/updates.css';

const ANNOUNCED_KEY = 'spark.update-announced';

function announcedVersion(): string | null {
  try {
    return localStorage.getItem(ANNOUNCED_KEY);
  } catch {
    return null;
  }
}

function rememberAnnounced(version: string): void {
  try {
    localStorage.setItem(ANNOUNCED_KEY, version);
  } catch {
    return;
  }
}

function readyVersion(status: UpdateStatus | null): string | null {
  return status?.phase === 'ready' ? status.availableVersion : null;
}

export function UpdateChip() {
  const status = useUpdateStatus();
  const toaster = useToast();
  const { install, starting } = useInstallUpdate();
  const version = readyVersion(status);
  const { show } = toaster;

  useEffect(() => {
    if (!version || announcedVersion() === version) return;
    rememberAnnounced(version);
    show({
      text: `Spark Outpost ${version} is ready. It installs when you quit, or pick Update in the sidebar.`,
    });
  }, [version, show]);

  const restart = async () => {
    const reason = await install();
    if (reason) show({ text: reason });
  };

  return (
    <>
      {version && (
        <button
          type="button"
          className="rail-btn upd-chip"
          aria-label={`Update ready: restart to install Spark Outpost ${version}`}
          title={`Restart to install ${version}`}
          disabled={starting}
          onClick={() => void restart()}
        >
          <span className="upd-chip-icon" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
          Update
        </button>
      )}
      {createPortal(
        <div className="upd-toasts">
          <ToastHost toaster={toaster} />
        </div>,
        document.body,
      )}
    </>
  );
}
