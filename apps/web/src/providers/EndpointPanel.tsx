import { useId, type FormEvent } from 'react';
import { customEndpointProblem, type ProviderSetup } from '@spark-outpost/contracts';
import type { ProviderConnect } from './use-provider-connect.ts';
import type { EndpointFields } from './endpoint-fields.ts';

type FieldKey = keyof EndpointFields;

const FIELDS: { key: FieldKey; label: string; placeholder: string; type: 'url' | 'text' }[] = [
  { key: 'baseUrl', label: 'Server address', placeholder: 'http://localhost:11434', type: 'url' },
  { key: 'model', label: 'Model', placeholder: 'qwen3-coder:30b', type: 'text' },
  { key: 'fastModel', label: 'Fast model (optional)', placeholder: 'Same as Model', type: 'text' },
];

function started(fields: EndpointFields): boolean {
  return fields.baseUrl.trim() !== '' || fields.model.trim() !== '';
}

export function EndpointPanel({
  setup,
  connect,
}: {
  setup: ProviderSetup;
  connect: ProviderConnect;
}) {
  const id = useId();
  const fields = connect.endpoint;
  const problem = customEndpointProblem(fields);
  const shownProblem = started(fields) ? problem : null;
  const disabled = connect.verifying;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem && !disabled) void connect.verify();
  };

  return (
    <form className="mpanel ep-form" onSubmit={submit} aria-label={`Connect ${setup.name}`}>
      {FIELDS.map((field) => (
        <div className="ep-field" key={field.key}>
          <label htmlFor={`${id}-${field.key}`}>{field.label}</label>
          <input
            id={`${id}-${field.key}`}
            className="inp"
            type={field.type}
            value={fields[field.key]}
            onChange={(event) =>
              connect.setEndpoint({ ...fields, [field.key]: event.target.value })
            }
            placeholder={field.placeholder}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
        </div>
      ))}
      <div className="ep-field">
        <label htmlFor={`${id}-key`}>API key (optional)</label>
        <div className="keyrow">
          <input
            id={`${id}-key`}
            className="inp"
            type={connect.showKey ? 'text' : 'password'}
            value={connect.apiKey}
            onChange={(event) => connect.setApiKey(event.target.value)}
            placeholder="Leave empty if your server needs none"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
          <button
            type="button"
            className="btn line sm"
            onClick={connect.toggleShowKey}
            disabled={disabled}
          >
            {connect.showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div className={`hintline${shownProblem ? ' bad' : ''}`} role="status">
        {shownProblem ?? setup.keyHint}
      </div>
      <button type="submit" className="btn primary sm" disabled={disabled || problem !== null}>
        Test connection
      </button>
    </form>
  );
}
