import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ATLASSIAN_NAME,
  saveTicketConnectionRequestSchema,
  ticketSourceNames,
  type SaveTicketConnectionRequest,
  type ServiceNowAuthKind,
  type TicketConnections,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { atLeast } from '../ui/min-duration.ts';
import { fadeReveal } from '../ui/transitions.tsx';
import { ConnectBlob } from './ConnectBlob.tsx';
import {
  CELEBRATE_MS,
  checkFailure,
  MIN_CHECK_MS,
  type CheckFailure,
  type CheckMood,
  type ConnectField,
} from './connect-check.ts';
import { jiraSiteHost, jiraSiteUrl } from './jira-site.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';
import './connect.css';

export const JIRA_TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens';
export const LINEAR_KEY_URL = 'https://linear.app/settings/account/security';

interface TicketConnectFormProps {
  source: TicketSourceId;
  onConnected?: (connections: TicketConnections) => void;
  onCancel?: () => void;
}

interface FieldSpec {
  key: ConnectField;
  label: string;
  placeholder: string;
  type: 'text' | 'email' | 'password';
  inputMode?: 'url' | 'email';
  help: ReactNode;
}

export function HelpLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="tk-help-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLinkIcon />
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  );
}

const INSTANCE_FIELD: FieldSpec = {
  key: 'instanceUrl',
  label: 'Instance',
  placeholder: 'acme.service-now.com',
  type: 'text',
  inputMode: 'url',
  help: 'Type acme or the full address. Spark connects over https only.',
};

const SERVICENOW_FIELDS: Record<ServiceNowAuthKind, FieldSpec[]> = {
  basic: [
    {
      key: 'username',
      label: 'Username',
      placeholder: 'jordan.lee',
      type: 'text',
      help: 'The user name you sign in to ServiceNow with.',
    },
    {
      key: 'password',
      label: 'Password',
      placeholder: 'Your ServiceNow password',
      type: 'password',
      help: 'If you sign in to ServiceNow with SSO, or your instance blocks password sign-in, ask your admin for an API key or a web service account.',
    },
  ],
  api_key: [
    {
      key: 'username',
      label: 'Username',
      placeholder: 'jordan.lee',
      type: 'text',
      help: 'The ServiceNow user the API key belongs to.',
    },
    {
      key: 'apiKey',
      label: 'API key',
      placeholder: 'Paste your API key',
      type: 'password',
      help: 'Your ServiceNow admin creates it for your account.',
    },
  ],
};

const AUTH_OPTIONS: { id: ServiceNowAuthKind; label: string }[] = [
  { id: 'basic', label: 'Username and password' },
  { id: 'api_key', label: 'API key' },
];

const FIELDS: Record<Exclude<TicketSourceId, 'servicenow'>, FieldSpec[]> = {
  jira: [
    {
      key: 'siteUrl',
      label: 'Site URL',
      placeholder: 'yourcompany.atlassian.net',
      type: 'text',
      inputMode: 'url',
      help: 'The address you open Jira or Confluence at.',
    },
    {
      key: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      type: 'email',
      inputMode: 'email',
      help: 'Use the email you sign in to Atlassian with.',
    },
    {
      key: 'apiToken',
      label: 'API token',
      placeholder: 'Paste your API token',
      type: 'password',
      help: (
        <>
          <HelpLink href={JIRA_TOKEN_URL}>Create an API token</HelpLink> in your Atlassian account,
          then paste it here.
        </>
      ),
    },
  ],
  linear: [
    {
      key: 'apiKey',
      label: 'API key',
      placeholder: 'lin_api_…',
      type: 'password',
      help: (
        <>
          <HelpLink href={LINEAR_KEY_URL}>Create a personal API key</HelpLink> in Linear under
          Settings → Security &amp; access.
        </>
      ),
    },
  ],
};

function requestFor(
  source: TicketSourceId,
  authKind: ServiceNowAuthKind,
  values: Record<string, string>,
) {
  if (source === 'servicenow') {
    const signIn =
      authKind === 'basic'
        ? { authKind, password: values.password ?? '' }
        : { authKind, apiKey: values.apiKey ?? '' };
    return {
      source,
      instanceUrl: values.instanceUrl ?? '',
      username: values.username ?? '',
      ...signIn,
    };
  }
  return source === 'linear'
    ? { source, apiKey: values.apiKey ?? '' }
    : {
        source,
        siteUrl: jiraSiteUrl(values.siteUrl ?? ''),
        email: (values.email ?? '').trim(),
        apiToken: values.apiToken ?? '',
      };
}

function fieldsFor(source: TicketSourceId, authKind: ServiceNowAuthKind): FieldSpec[] {
  return source === 'servicenow' ? SERVICENOW_FIELDS[authKind] : FIELDS[source];
}

function statusLine(mood: CheckMood | null, name: string): string {
  if (mood === 'checking') return `Checking with ${name}…`;
  if (mood === 'happy') return 'Connected!';
  return '';
}

export function TicketConnectForm({ source, onConnected, onCancel }: TicketConnectFormProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const firstRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<CheckFailure | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [authKind, setAuthKind] = useState<ServiceNowAuthKind>('basic');
  const name = source === 'jira' ? ATLASSIAN_NAME : ticketSourceNames[source];
  const connect = useMutation({
    mutationFn: (body: SaveTicketConnectionRequest) =>
      atLeast(ticketsApi.connect(body), MIN_CHECK_MS),
  });
  const failure =
    invalid ?? (connect.isError ? checkFailure(source, connect.error, authKind) : null);
  const busy = connect.isPending || connect.isSuccess;
  let mood: CheckMood | null = null;
  if (connect.isPending) mood = 'checking';
  else if (connect.isSuccess) mood = 'happy';
  else if (connect.isError && failure) mood = failure.mood;

  const finish = useEffectEvent((connections: TicketConnections) => {
    setValues({});
    queryClient.setQueryData(ticketKeys.connections, connections);
    void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    onConnected?.(connections);
  });

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const connections = connect.data;
    if (!connections) return;
    const timer = setTimeout(() => finish(connections), CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [connect.data]);

  const failedField = failure?.field ?? null;
  useEffect(() => {
    if (failedField) document.getElementById(`${id}-${failedField}`)?.focus();
  }, [failedField, id]);

  const change = (key: ConnectField, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setInvalid(null);
    if (connect.isError) connect.reset();
  };

  const tidySite = (value: string) => {
    const host = jiraSiteHost(value);
    if (host !== value) setValues((current) => ({ ...current, siteUrl: host }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = saveTicketConnectionRequestSchema.safeParse(
      requestFor(source, authKind, values),
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setInvalid({
        message: issue?.message ?? 'Check the fields.',
        field: (issue?.path[0] as ConnectField | undefined) ?? null,
        mood: 'neutral',
      });
      connect.reset();
      return;
    }
    setInvalid(null);
    connect.mutate(parsed.data);
  };

  const field = (spec: FieldSpec, index: number) => {
    const inputId = `${id}-${spec.key}`;
    const helpId = `${inputId}-help`;
    const errorId = `${inputId}-error`;
    const error = failure?.field === spec.key ? failure.message : null;
    const secret = spec.type === 'password';
    return (
      <div className="tk-field" key={spec.key}>
        <label htmlFor={inputId}>{spec.label}</label>
        <div className="tk-keyrow">
          <input
            ref={index === 0 ? firstRef : undefined}
            id={inputId}
            className={secret ? 'inp mono' : 'inp'}
            type={secret && revealed ? 'text' : spec.type}
            inputMode={spec.inputMode}
            value={values[spec.key] ?? ''}
            onChange={(event) => change(spec.key, event.target.value)}
            onBlur={spec.key === 'siteUrl' ? (event) => tidySite(event.target.value) : undefined}
            placeholder={spec.placeholder}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${helpId}` : helpId}
          />
          {secret && (
            <button
              type="button"
              className="btn line sm"
              onClick={() => setRevealed(!revealed)}
              disabled={busy}
            >
              {revealed ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              key="error"
              id={errorId}
              className="tk-field-err"
              role="alert"
              {...fadeReveal}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <p id={helpId} className="tk-field-help">
          {spec.help}
        </p>
      </div>
    );
  };

  return (
    <form
      className="tk-cform"
      onSubmit={submit}
      aria-label={`Connect ${name}`}
      aria-busy={connect.isPending}
      noValidate
    >
      {source === 'servicenow' && field(INSTANCE_FIELD, 0)}
      {source === 'servicenow' && (
        <div className="tk-field">
          <span className="tk-field-label" aria-hidden="true">
            Sign in with
          </span>
          <Segmented
            ariaLabel="Sign in with"
            options={AUTH_OPTIONS}
            value={authKind}
            onChange={(id) => {
              setAuthKind(id as ServiceNowAuthKind);
              setInvalid(null);
              if (connect.isError) connect.reset();
            }}
          />
        </div>
      )}
      {fieldsFor(source, authKind).map((spec, index) =>
        field(spec, source === 'servicenow' ? index + 1 : index),
      )}
      {failure && !failure.field && (
        <p className="tk-cform-err" role="alert">
          {failure.message}
        </p>
      )}
      <div className="tk-cform-acts">
        <button type="submit" className="btn primary sm" disabled={busy}>
          {connect.isPending ? 'Checking…' : 'Save and check'}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <span className="tk-check">
          <AnimatePresence>{mood && <ConnectBlob key="blob" mood={mood} />}</AnimatePresence>
          <span className="tk-check-say" role="status">
            {statusLine(mood, name)}
          </span>
        </span>
      </div>
      <p className="tk-hint">Keys stay in your macOS keychain and are never shown again.</p>
    </form>
  );
}
