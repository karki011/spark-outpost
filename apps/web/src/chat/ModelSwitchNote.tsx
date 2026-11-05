import { modelSwitchText, type ModelSwitch } from '@spark-outpost/contracts';
import { requestSettings } from '../settings/settings-request.ts';
import { timedOut } from './approvals/timed-out.ts';
import { TimedOutNote } from './approvals/TimedOutNote.tsx';
import './composer/unusable-model.css';

function ModelsLink() {
  return (
    <button type="button" className="models-link" onClick={() => requestSettings('models')}>
      Settings › Models
    </button>
  );
}

export function ModelSwitchNote({ change }: { change: ModelSwitch | null | undefined }) {
  if (!change?.to) return null;
  return (
    <p className="ai-note model-switch-note" role="status">
      {modelSwitchText(change)} <ModelsLink />
    </p>
  );
}

export interface TimedOutFacts {
  asked: string | null;
  retryIn: string | null;
}

interface ErrorLineProps {
  error: string | null;
  details?: string | null | undefined;
  change?: ModelSwitch | null | undefined;
  waited?: TimedOutFacts | undefined;
}

export function ErrorLine({ error, details, change, waited }: ErrorLineProps) {
  if (!error) return null;
  if (timedOut(error)) {
    return <TimedOutNote asked={waited?.asked ?? null} conversationId={waited?.retryIn ?? null} />;
  }
  return (
    <>
      <p className="error-line">
        {error} {change && <ModelsLink />}
      </p>
      {details && (
        <details className="error-details">
          <summary>Details from the provider</summary>
          <pre>{details}</pre>
        </details>
      )}
    </>
  );
}
