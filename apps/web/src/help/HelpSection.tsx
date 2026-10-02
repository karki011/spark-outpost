import { useEffect, useId, useState } from 'react';
import type { DesktopHelpInfo } from '@spark-outpost/contracts';
import { BetaBadge } from '../desktop/BetaBadge.tsx';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { SettingRow } from '../settings/SettingRow.tsx';
import { exportDiagnostics, outcomeText } from './export-diagnostics.ts';
import { FeedbackForm } from './FeedbackForm.tsx';
import '../desktop/updates.css';
import './help.css';

const DIAGNOSTICS_HINT =
  'A zip with versions, settings and recent logs, for you to attach to a bug report. It never holds chats, prompts, file contents, keys or tokens.';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Spark couldn't export diagnostics.";
}

function DiagnosticsRow() {
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      setMessage(outcomeText(await exportDiagnostics()));
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      label="Diagnostics"
      doc={{ page: 'troubleshooting', heading: 'send-diagnostics-with-a-bug-report' }}
      hint={message ?? DIAGNOSTICS_HINT}
      hintId={hintId}
    >
      <button
        type="button"
        className="btn line sm"
        aria-describedby={hintId}
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Exporting…' : 'Export diagnostics'}
      </button>
    </SettingRow>
  );
}

function AppRows({ info }: { info: DesktopHelpInfo }) {
  const versionHint = useId();
  const logsHint = useId();
  const help = sparkDesktop()?.help;
  return (
    <>
      <SettingRow
        label="Version"
        hint={info.beta ? 'A beta build. Thanks for trying it early.' : 'A stable build.'}
        hintId={versionHint}
      >
        <span className="upd-version">
          Spark Outpost {info.version}
          <BetaBadge version={info.version} />
        </span>
      </SettingRow>
      <SettingRow label="Logs folder" hint={info.logsFolder} hintId={logsHint}>
        <button
          type="button"
          className="btn line sm"
          aria-describedby={logsHint}
          onClick={() => void help?.showLogs()}
        >
          Show in Finder
        </button>
      </SettingRow>
    </>
  );
}

function useHelpInfo(): { desktop: boolean; info: DesktopHelpInfo | null } {
  const help = sparkDesktop()?.help ?? null;
  const [info, setInfo] = useState<DesktopHelpInfo | null>(null);
  useEffect(() => {
    if (!help) return;
    let live = true;
    void help.info().then((loaded) => {
      if (live) setInfo(loaded);
    });
    return () => {
      live = false;
    };
  }, [help]);
  return { desktop: help !== null, info };
}

export function HelpSection() {
  const { desktop, info } = useHelpInfo();
  return (
    <>
      <p className="lede">
        Tell the Spark Outpost team what went wrong or what you'd like. Nothing leaves your Mac
        unless you send it yourself.
      </p>
      {desktop &&
        (info ? (
          <AppRows info={info} />
        ) : (
          <div className="upd-skeleton" aria-busy="true" aria-label="Loading app details">
            <i />
            <i />
            <i />
            <i />
          </div>
        ))}
      <DiagnosticsRow />
      <FeedbackForm version={info?.version ?? null} beta={info?.beta ?? false} />
    </>
  );
}
