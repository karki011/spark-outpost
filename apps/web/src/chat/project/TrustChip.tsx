import type { RepoAgentConfig } from '@spark-outpost/contracts';
import { executableSummary } from './agent-setup.ts';
import type { AgentConfigChange } from './use-agent-config.ts';

interface TrustChipProps {
  config: RepoAgentConfig;
  prompt: 'ask' | 'changed';
  name: string;
  busy: boolean;
  canDecide: boolean;
  error: string | null;
  onChange: (change: AgentConfigChange) => void;
  onReview: () => void;
}

export function TrustChip({
  config,
  prompt,
  name,
  busy,
  canDecide,
  error,
  onChange,
  onReview,
}: TrustChipProps) {
  const asking = prompt === 'ask';
  return (
    <div className="ctx-trust" role="group" aria-label={`Trust ${name}?`}>
      <span className="ctx-trust-text">
        <span className="ctx-trust-title">
          {asking ? 'Trust this folder?' : 'Folder setup changed'}
        </span>
        {asking && <span className="ctx-trust-summary">{executableSummary(config)}</span>}
      </span>
      {asking && canDecide && (
        <>
          <button
            type="button"
            className="btn primary sm ctx-trust-btn"
            disabled={busy}
            onClick={() =>
              onChange({
                type: 'trust',
                change: { trusted: true, fingerprint: config.trust.fingerprint },
              })
            }
          >
            Trust
          </button>
          <button
            type="button"
            className="btn ghost sm ctx-trust-btn"
            disabled={busy}
            onClick={() => onChange({ type: 'trust', change: { trusted: false } })}
          >
            Not now
          </button>
        </>
      )}
      <button type="button" className="btn line sm ctx-trust-btn" onClick={onReview}>
        Review
      </button>
      {error && (
        <span className="ctx-trust-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
