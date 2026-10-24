import { useRef, useState } from 'react';
import { DisconnectDialog } from '../../connectors/DisconnectDialog.tsx';
import { sparkRulesApi } from '../../api/spark-rules.ts';
import { sparkDesktop } from '../../desktop/desktop-bridge.ts';
import { FileIcon } from '../../ui/icons.tsx';
import { useRulesWrite } from './use-spark-rules.ts';

const RECOMMENDED_COPY = {
  title: 'Use recommended rules?',
  text: 'Spark sets its recommended choice on every rule on this page. Your allowed gh commands and anything else in settings.json stay.',
};

function useOpenFile() {
  const [problem, setProblem] = useState<string | null>(null);
  const opener = sparkDesktop()?.sparkRules;
  const open = async () => {
    const result = await opener?.openFile();
    setProblem(result && !result.opened ? (result.error ?? "settings.json didn't open.") : null);
  };
  return { canOpen: Boolean(opener), open, problem };
}

export function RulesActions({ malformed }: { malformed: boolean }) {
  const file = useOpenFile();
  const recommended = useRulesWrite(() => sparkRulesApi.useRecommended());
  const [confirming, setConfirming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setConfirming(false);
    button.current?.focus();
  };
  const note =
    file.problem ??
    recommended.error?.message ??
    (recommended.isSuccess ? 'Recommended rules are in settings.json.' : null);
  return (
    <>
      <div className="rules-actions">
        {file.canOpen && (
          <button type="button" className="btn line sm" onClick={() => void file.open()}>
            <FileIcon />
            Open settings.json
          </button>
        )}
        <button
          ref={button}
          type="button"
          className="btn line sm"
          disabled={malformed || recommended.isPending}
          onClick={() => setConfirming(true)}
        >
          Use recommended rules
        </button>
      </div>
      <p className="set-hint rules-action-note" aria-live="polite">
        {note}
      </p>
      {confirming && (
        <DisconnectDialog
          copy={RECOMMENDED_COPY}
          confirmLabel="Use recommended rules"
          onCancel={close}
          onConfirm={() => {
            close();
            recommended.mutate(undefined);
          }}
        />
      )}
    </>
  );
}
