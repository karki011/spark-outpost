import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlobScout } from '../brand/BlobScout.tsx';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { installMessage, useInstallUpdate } from '../desktop/use-install-update.ts';
import { useUpdateStatus } from '../desktop/use-update-status.ts';
import { useReducedMotion } from '../ui/motion.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { updateBlobView } from './update-blob-state.ts';
import '../desktop/updates.css';

const ANNOUNCED_KEY = 'spark.update-announced';
const HOP_EVERY_MS = 14_000;
const HOP_FOR_MS = 1_200;

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

function useOccasionalHop(enabled: boolean): boolean {
  const [hopping, setHopping] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let stop: ReturnType<typeof setTimeout> | undefined;
    const every = setInterval(() => {
      setHopping(true);
      stop = setTimeout(() => setHopping(false), HOP_FOR_MS);
    }, HOP_EVERY_MS);
    return () => {
      clearInterval(every);
      clearTimeout(stop);
      setHopping(false);
    };
  }, [enabled]);
  return hopping;
}

export function UpdateBlob() {
  const status = useUpdateStatus();
  const reduced = useReducedMotion();
  const toaster = useToast();
  const install = useInstallUpdate();
  const view = updateBlobView(status);
  const hopping = useOccasionalHop(view?.step === 'ready' && !reduced);
  const { triggerProps, tooltip } = useTooltip(view?.description ?? '', { side: 'top' });
  const readyVersion = status?.phase === 'ready' ? status.availableVersion : null;
  const { show } = toaster;

  useEffect(() => {
    if (!readyVersion || announcedVersion() === readyVersion) return;
    rememberAnnounced(readyVersion);
    show({
      text: `Spark Outpost ${readyVersion} is ready. Click the Spark above Settings to get it.`,
    });
  }, [readyVersion, show]);

  const getLatest = async () => {
    const message = installMessage(await install());
    if (message) show({ text: message });
  };

  return (
    <>
      {view && (
        <button
          type="button"
          className={`rail-btn upd-blob ${view.step}${hopping ? ' nudge' : ''}`}
          aria-label={view.description}
          aria-busy={view.step === 'downloading' || view.step === 'installing'}
          disabled={view.step === 'installing'}
          onClick={() => void getLatest()}
          {...triggerProps}
        >
          <span className="upd-blob-art">
            <BlobScout size={30} mood={view.mood} />
            {view.step === 'ready' && <i className="upd-blob-dot" aria-hidden="true" />}
          </span>
          {view.progress !== null && (
            <span className="upd-blob-bar" aria-hidden="true">
              <i style={{ width: `${view.progress}%` }} />
            </span>
          )}
          {view.label}
        </button>
      )}
      {tooltip}
      {createPortal(
        <div className="upd-toasts">
          <ToastHost toaster={toaster} />
        </div>,
        document.body,
      )}
    </>
  );
}
