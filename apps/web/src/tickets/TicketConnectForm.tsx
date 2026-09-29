import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  saveTicketConnectionRequestSchema,
  ticketSourceNames,
  type TicketConnections,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

interface TicketConnectFormProps {
  source: TicketSourceId;
  onConnected?: (connections: TicketConnections) => void;
  onCancel?: () => void;
}

const HELP: Record<TicketSourceId, string> = {
  linear: 'Create a personal API key in Linear under Settings → Security & access.',
  jira: 'Create an Atlassian API token at id.atlassian.com under Security → API tokens. Spark checks it with Jira before saving.',
};

function fieldsFor(source: TicketSourceId, values: Record<string, string>) {
  return source === 'linear'
    ? { source, apiKey: values.apiKey ?? '' }
    : {
        source,
        siteUrl: values.siteUrl ?? '',
        email: values.email ?? '',
        apiToken: values.apiToken ?? '',
      };
}

export function TicketConnectForm({ source, onConnected, onCancel }: TicketConnectFormProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const name = ticketSourceNames[source];
  const connect = useMutation({
    mutationFn: ticketsApi.connect,
    onSuccess: async (connections) => {
      setValues({});
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      onConnected?.(connections);
    },
    onError: (error: Error) => setProblem(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = saveTicketConnectionRequestSchema.safeParse(fieldsFor(source, values));
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the fields.');
      return;
    }
    setProblem(null);
    connect.mutate(parsed.data);
  };

  const field = (key: string, label: string, props: Record<string, string>) => (
    <label className="field" htmlFor={`${id}-${key}`}>
      <span>{label}</span>
      <input
        id={`${id}-${key}`}
        className="inp"
        value={values[key] ?? ''}
        onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
        disabled={connect.isPending}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
    </label>
  );

  return (
    <form className="tk-cform" onSubmit={submit} aria-label={`Connect ${name}`} noValidate>
      {source === 'jira' ? (
        <>
          {field('siteUrl', 'Site URL', {
            type: 'url',
            placeholder: 'https://your-site.atlassian.net',
          })}
          {field('email', 'Email', { type: 'email', placeholder: 'you@example.com' })}
          {field('apiToken', 'API token', {
            type: 'password',
            placeholder: 'Paste your API token',
          })}
        </>
      ) : (
        field('apiKey', 'API key', { type: 'password', placeholder: 'lin_api_…' })
      )}
      <p className="tk-hint">{HELP[source]}</p>
      {problem && (
        <p className="tk-cform-err" role="alert">
          {problem}
        </p>
      )}
      <div className="tk-cform-acts">
        <button type="submit" className="btn primary sm" disabled={connect.isPending}>
          {connect.isPending ? `Checking with ${name}…` : 'Save and check'}
        </button>
        {connect.isPending && <span className="pdot" aria-hidden="true" />}
        {onCancel && (
          <button type="button" className="btn ghost sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p className="tk-hint">Keys stay in your macOS keychain and are never shown again.</p>
    </form>
  );
}
