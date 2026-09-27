import { apiKeyHint, type ConnectableSetup, type ConnectionMethod } from '@spark-outpost/contracts';
import { ExternalLinkIcon } from '../ui/icons.tsx';

function LinkedHint({ text, link }: { text: string; link: ConnectableSetup['keyLink'] }) {
  const at = link ? text.indexOf(link.text) : -1;
  if (!link || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a className="key-link" href={link.url} target="_blank" rel="noopener noreferrer">
        {link.text}
        <ExternalLinkIcon />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      {text.slice(at + link.text.length)}
    </>
  );
}

interface MethodPanelProps {
  provider: ConnectableSetup;
  method: ConnectionMethod;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  disabled: boolean;
  cliButtonLabel: string;
  onVerify: () => void;
  onOpenTerminal?: (() => void) | undefined;
}

export function MethodPanel({
  provider,
  method,
  apiKey,
  onApiKeyChange,
  showKey,
  onToggleShowKey,
  disabled,
  cliButtonLabel,
  onVerify,
  onOpenTerminal,
}: MethodPanelProps) {
  if (method === 'cli') {
    return (
      <div className="mpanel">
        <p>
          Uses the <code>{provider.cli}</code> CLI on this machine and its own login. Spark Outpost
          runs the CLI but never reads or stores your credentials.
        </p>
        <div className="mactions">
          <button type="button" className="btn primary sm" onClick={onVerify} disabled={disabled}>
            {cliButtonLabel}
          </button>
          {onOpenTerminal && (
            <button type="button" className="btn line sm" onClick={onOpenTerminal}>
              Open terminal
            </button>
          )}
        </div>
      </div>
    );
  }

  const hint = apiKeyHint(provider, apiKey);

  return (
    <div className="mpanel">
      <div className="keyrow">
        <input
          className={`inp${hint.tone === 'bad' ? ' bad' : ''}`}
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && hint.valid && !disabled) onVerify();
          }}
          placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : 'Paste your API key'}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${provider.name} API key`}
          disabled={disabled}
        />
        <button type="button" className="btn line sm" onClick={onToggleShowKey} disabled={disabled}>
          {showKey ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className={`hintline${hint.tone === 'neutral' ? '' : ` ${hint.tone}`}`}>
        {hint.tone === 'neutral' ? (
          <LinkedHint text={hint.message} link={provider.keyLink} />
        ) : (
          hint.message
        )}
      </div>
      <button
        type="button"
        className="btn primary sm"
        onClick={onVerify}
        disabled={disabled || !hint.valid}
      >
        Verify key
      </button>
    </div>
  );
}
