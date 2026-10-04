import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  saveSlackConnectionRequestSchema,
  slackManifestJson,
  type SaveSlackConnectionRequest,
} from '@spark-outpost/contracts';
import { HelpLink } from '../tickets/TicketConnectForm.tsx';
import '../tickets/connect.css';
import { DocLink } from '../ui/DocLink.tsx';
import { slackApi, slackKeys } from './slack-api.ts';

export const SLACK_APPS_URL = 'https://api.slack.com/apps?new_app=1';

type TokenField = keyof SaveSlackConnectionRequest;

interface FieldSpec {
  key: TokenField;
  label: string;
  placeholder: string;
  help: string;
}

const FIELDS: FieldSpec[] = [
  {
    key: 'botToken',
    label: 'Bot token',
    placeholder: 'xoxb-…',
    help: 'OAuth & Permissions → Bot User OAuth Token. Needed for everything.',
  },
  {
    key: 'userToken',
    label: 'User token (optional)',
    placeholder: 'xoxp-…',
    help: 'OAuth & Permissions → User OAuth Token. Adds search and reading channels the app has not joined, tells Spark who to notify, and is needed if you later let Spark read direct messages you pick.',
  },
  {
    key: 'appToken',
    label: 'App-level token (optional)',
    placeholder: 'xapp-…',
    help: 'Basic Information → App-Level Tokens, with the connections:write scope. Lets you start work from Slack over Socket Mode.',
  },
];

export function CopyManifest({ label = 'Copy manifest' }: { label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(slackManifestJson());
    setCopied(true);
  };
  return (
    <>
      <button type="button" className="btn line sm" onClick={() => void copy()}>
        {label}
      </button>
      <span className="sl-copied" role="status">
        {copied ? 'Copied. Paste it in the next step.' : ''}
      </span>
    </>
  );
}

function ManifestSteps() {
  return (
    <ol className="sl-steps" aria-label="Create your Slack app">
      <li>
        <CopyManifest />
      </li>
      <li>
        <HelpLink href={SLACK_APPS_URL}>Create a Slack app</HelpLink> from a manifest, choose your
        workspace and paste the manifest (JSON).
      </li>
      <li>Install the app to your workspace, then copy the tokens into the fields below.</li>
      <li>
        In Slack, invite the app to each channel it should read or post in: type{' '}
        <code>/invite @Spark</code> there.
      </li>
      <li>
        Direct messages stay unread. The user token carries four scopes for them (
        <code>im:read</code>, <code>im:history</code>, <code>mpim:read</code>,{' '}
        <code>mpim:history</code>), used only for conversations you pick after turning on{' '}
        <b>Let Spark read my direct messages</b>.
      </li>
    </ol>
  );
}

export function SlackConnectForm({ onConnected }: { onConnected?: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const firstRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<{ field: TokenField | null; message: string } | null>(
    null,
  );
  const [revealed, setRevealed] = useState(false);
  const connect = useMutation({
    mutationFn: slackApi.connect,
    onSuccess: (status) => {
      setValues({});
      queryClient.setQueryData(slackKeys.status, status);
      onConnected?.();
    },
  });
  const failure =
    invalid ?? (connect.isError ? { field: null, message: connect.error.message } : null);

  useEffect(() => {
    if (failure?.field) document.getElementById(`${id}-${failure.field}`)?.focus();
  }, [failure?.field, id]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (connect.isPending) return;
    const parsed = saveSlackConnectionRequestSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = (issue?.path[0] as TokenField | undefined) ?? null;
      setInvalid({
        field,
        message:
          field === 'botToken' && !values.botToken
            ? 'Paste the bot token.'
            : (issue?.message ?? 'Check the tokens.'),
      });
      return;
    }
    setInvalid(null);
    connect.mutate(parsed.data);
  };

  const change = (key: TokenField, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setInvalid(null);
    if (connect.isError) connect.reset();
  };

  return (
    <form
      className="tk-cform"
      onSubmit={submit}
      aria-label="Connect Slack"
      aria-busy={connect.isPending}
      noValidate
    >
      <p className="tk-field-help">
        Spark runs on your Mac, so you connect your own small Slack app. Nothing passes through a
        Spark server. <DocLink topic="Connect Slack" doc={{ page: 'connect-slack' }} />
      </p>
      <ManifestSteps />
      {FIELDS.map((spec, index) => {
        const inputId = `${id}-${spec.key}`;
        const error = failure?.field === spec.key ? failure.message : null;
        return (
          <div className="tk-field" key={spec.key}>
            <label htmlFor={inputId}>{spec.label}</label>
            <div className="tk-keyrow">
              <input
                ref={index === 0 ? firstRef : undefined}
                id={inputId}
                className="inp mono"
                type={revealed ? 'text' : 'password'}
                value={values[spec.key] ?? ''}
                onChange={(event) => change(spec.key, event.target.value)}
                placeholder={spec.placeholder}
                disabled={connect.isPending}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-error ${inputId}-help` : `${inputId}-help`}
              />
              {index === 0 && (
                <button
                  type="button"
                  className="btn line sm"
                  onClick={() => setRevealed(!revealed)}
                  disabled={connect.isPending}
                >
                  {revealed ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            {error && (
              <p id={`${inputId}-error`} className="tk-field-err" role="alert">
                {error}
              </p>
            )}
            <p id={`${inputId}-help`} className="tk-field-help">
              {spec.help}
            </p>
          </div>
        );
      })}
      {failure && !failure.field && (
        <p className="tk-cform-err" role="alert">
          {failure.message}
        </p>
      )}
      <div className="tk-cform-acts">
        <button type="submit" className="btn primary sm" disabled={connect.isPending}>
          {connect.isPending ? 'Checking…' : 'Save and check'}
        </button>
        <span className="tk-check-say" role="status">
          {connect.isPending ? 'Checking with Slack…' : ''}
        </span>
      </div>
      <p className="tk-hint">
        Tokens stay in your macOS keychain and are never shown again. Paste them only here, never in
        a chat.
      </p>
    </form>
  );
}
