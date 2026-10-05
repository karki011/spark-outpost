import { modelSwitchText, type ModelSwitch } from '@spark-outpost/contracts';
import { requestSettings } from '../settings/settings-request.ts';
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

interface ErrorLineProps {
  error: string | null;
  details?: string | null | undefined;
  change?: ModelSwitch | null | undefined;
}

export function ErrorLine({ error, details, change }: ErrorLineProps) {
  if (!error) return null;
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
