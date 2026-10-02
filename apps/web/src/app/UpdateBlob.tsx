import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlobScout } from '../brand/BlobScout.tsx';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { installMessage, useInstallUpdate } from '../desktop/use-install-update.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import { useUpdateStatus } from '../desktop/use-update-status.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { useReducedMotion } from '../ui/motion.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { previewUpdatedText, shownFill, updateBlobView } from './update-blob-state.ts';
import '../desktop/updates.css';

const ANNOUNCED_KEY = 'spark.update-announced';
const CELEBRATED_KEY = 'spark.update-celebrated';
const HOP_EVERY_MS = 14_000;
const HOP_FOR_MS = 1_200;
const CELEBRATE_FOR_MS = 8_000;

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

function celebratedVersion(): string | null {
  try {
    return sessionStorage.getItem(CELEBRATED_KEY);
  } catch {
    return null;
  }
}

function rememberCelebrated(version: string): void {
  try {
    sessionStorage.setItem(CELEBRATED_KEY, version);
  } catch {
    return;
  }
}

function useCelebration(version: string | null, show: (toast: { text: string }) => void) {
  const [celebratingFor, setCelebratingFor] = useState<string | null>(null);
  useEffect(() => {
    if (!version || celebratedVersion() === version) return;
    const start = setTimeout(() => {
      rememberCelebrated(version);
      show({ text: previewUpdatedText(version) });
      setCelebratingFor(version);
    }, 0);
    const stop = setTimeout(() => setCelebratingFor(null), CELEBRATE_FOR_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [version, show]);
  return {
    celebrating: celebratingFor !== null && celebratingFor === version,
    stopCelebrating: () => setCelebratingFor(null),
  };
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
  const calm = useCompanionStatus()?.calm ?? false;
  const reduced = useReducedMotion();
  const toaster = useToast();
  const install = useInstallUpdate();
  const { show } = toaster;
  const { celebrating, stopCelebrating } = useCelebration(status?.previewUpdatedTo ?? null, show);
  const view = updateBlobView(status, celebrating);
  const offering = view?.step === 'available' || view?.step === 'ready';
  const hopping = useOccasionalHop(offering && !calm && !reduced);
  const { triggerProps, tooltip } = useTooltip(view?.description ?? '', { side: 'top' });
  const readyVersion = status?.phase === 'ready' ? status.availableVersion : null;
  const fill = shownFill(view?.fill ?? null, reduced);

  useEffect(() => {
    if (!readyVersion || announcedVersion() === readyVersion) return;
    rememberAnnounced(readyVersion);
    show({
      text: `Spark Outpost ${readyVersion} is ready. Click the Spark above Settings to get it.`,
    });
  }, [readyVersion, show]);

  const getLatest = async () => {
    if (view?.step === 'updated') {
      stopCelebrating();
      requestSettings('updates');
      return;
    }
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
          data-fill={fill ?? undefined}
          disabled={view.step === 'installing'}
          onClick={() => void getLatest()}
          {...triggerProps}
        >
          <span className="upd-blob-art">
            <BlobScout size={30} mood={view.mood} fill={fill} />
            {view.step === 'ready' && <i className="upd-blob-dot" aria-hidden="true" />}
          </span>
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
