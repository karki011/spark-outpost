import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SLACK_ALLOWED_USERS_MAX,
  isSlackMessageUrl,
  slackUserIdSchema,
  type SlackConnection,
  type TicketStartMode,
} from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { requestChat } from '../app/chat-request.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import {
  allowSlackPlace,
  allowSlackPlaceLabel,
  slackApi,
  slackKeys,
  slackNotAllowed,
} from './slack-api.ts';
import type { SlackSave } from './use-slack-save.ts';

const MODES = [
  { id: 'plan', label: 'Plan first' },
  { id: 'build', label: 'Build' },
];
const CHANNEL_DEFAULT = '';

const SOCKET_LINES: Record<SlackConnection['socket'], string> = {
  off: 'Socket Mode is off.',
  connecting: 'Connecting to Slack…',
  connected: 'Listening for the shortcut and @mentions.',
  failed: "Couldn't reach Slack over Socket Mode. Spark keeps retrying.",
};

function StartFromLink({ onStarted }: { onStarted: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<TicketStartMode>('plan');
  const [projectId, setProjectId] = useState(CHANNEL_DEFAULT);
  const [note, setNote] = useState('');
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const start = useMutation({
    mutationFn: () =>
      slackApi.start({
        url: url.trim(),
        conversationId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        mode,
        note,
        ...(projectId ? { projectId } : {}),
      }),
    onSuccess: async (started) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      onStarted();
      requestChat(started.conversationId);
    },
  });
  const allow = useMutation({
    mutationFn: allowSlackPlace,
    onSuccess: (status) => {
      queryClient.setQueryData(slackKeys.status, status);
      start.mutate();
    },
  });
  const blocked = start.isError ? slackNotAllowed(start.error) : null;
  const valid = isSlackMessageUrl(url);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !start.isPending) start.mutate();
  };
  const projectChoices = [
    { id: CHANNEL_DEFAULT, label: "The channel's project" },
    ...(projects.data ?? []).map((project) => ({ id: project.id, label: project.name })),
  ];
  return (
    <form
      className="sl-start"
      onSubmit={submit}
      aria-label="Start work from a Slack link"
      noValidate
    >
      <div className="tk-field">
        <label htmlFor={`${id}-url`}>Start work from a Slack link</label>
        <input
          id={`${id}-url`}
          className="inp"
          type="url"
          placeholder="https://yourteam.slack.com/archives/…"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (start.isError) start.reset();
          }}
          aria-describedby={`${id}-url-help`}
        />
        <p id={`${id}-url-help`} className="tk-field-help">
          In Slack, use Copy link on a message. Spark opens a new chat with the thread attached.
        </p>
      </div>
      <Segmented
        ariaLabel="How to start"
        options={MODES}
        value={mode}
        onChange={(next) => setMode(next as TicketStartMode)}
      />
      <ChoicePicker
        label="Project folder"
        choices={projectChoices}
        value={projectId}
        onChange={setProjectId}
      />
      <label className="sr-only" htmlFor={`${id}-note`}>
        Note for the agent
      </label>
      <textarea
        id={`${id}-note`}
        className="inp"
        rows={2}
        placeholder="Add a note for the agent (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {start.isError && (
        <p className="tk-field-err" role="alert">
          {start.error.message}{' '}
          {blocked && (
            <button
              type="button"
              className="btn line sm"
              onClick={() => allow.mutate(blocked.channel)}
              disabled={allow.isPending}
            >
              {allowSlackPlaceLabel(blocked.channel)}
            </button>
          )}
        </p>
      )}
      <div className="cx-actions">
        <button type="submit" className="btn primary sm" disabled={!valid || start.isPending}>
          {start.isPending ? 'Starting…' : 'Start work'}
        </button>
      </div>
    </form>
  );
}

function AllowedUsers({ connection, save }: { connection: SlackConnection; save: SlackSave }) {
  const id = useId();
  const [value, setValue] = useState(connection.settings.allowedUserIds.join(', '));
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ids = value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const bad = ids.find((entry) => !slackUserIdSchema.safeParse(entry).success);
    if (bad || ids.length > SLACK_ALLOWED_USERS_MAX) {
      setProblem(
        bad
          ? `${bad} is not a Slack member ID (they look like U012AB3CD).`
          : `Allow up to ${SLACK_ALLOWED_USERS_MAX} people.`,
      );
      return;
    }
    setProblem(null);
    save.settings.mutate({ allowedUserIds: ids });
  };
  return (
    <form className="tk-field" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-users`}>Other people who may start work</label>
      <div className="tk-keyrow">
        <input
          id={`${id}-users`}
          className="inp mono"
          value={value}
          placeholder="Member IDs, separated by commas"
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-users-help`}
        />
        <button type="submit" className="btn line sm" disabled={save.settings.isPending}>
          Save
        </button>
      </div>
      {problem && (
        <p className="tk-field-err" role="alert">
          {problem}
        </p>
      )}
      <p id={`${id}-users-help`} className="tk-field-help">
        Only you can start work from Slack unless you add member IDs here.
      </p>
    </form>
  );
}

export function SlackStartSettings({
  connection,
  save,
  onStarted,
  onUseOwnApp,
}: {
  connection: SlackConnection;
  save: SlackSave;
  onStarted: () => void;
  onUseOwnApp: () => void;
}) {
  const id = useId();
  const { settings, tokens } = connection;
  if (connection.method === 'sign_in') {
    return (
      <section className="sl-section" aria-labelledby={`${id}-title`}>
        <h4 id={`${id}-title`}>Start work from Slack</h4>
        <StartFromLink onStarted={onStarted} />
        <p className="tk-field-help">
          Starting work from inside Slack, with @Spark or the message shortcut, needs your own Slack
          app: a sign-in has no bot to listen there.{' '}
          <button type="button" className="sl-inline" onClick={onUseOwnApp}>
            Set up your own Slack app
          </button>
        </p>
      </section>
    );
  }
  return (
    <section className="sl-section" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Start work from Slack</h4>
      <StartFromLink onStarted={onStarted} />
      <div className="tk-sync">
        <div>
          <label className="tk-switch">
            <BlobToggle
              size="sm"
              label="Start work from the Slack shortcut and @mentions"
              checked={settings.startFromSlack}
              disabled={!tokens.app}
              describedBy={`${id}-socket`}
              onChange={(next) => save.settings.mutate({ startFromSlack: next })}
            />
            <span>Start work from the Slack shortcut and @mentions</span>
          </label>
          <p id={`${id}-socket`} className="tk-field-help">
            {tokens.app
              ? settings.startFromSlack
                ? SOCKET_LINES[connection.socket]
                : SOCKET_LINES.off
              : 'Needs an app-level token (xapp-). Reconnect with one to turn this on.'}{' '}
            In an allowed channel, use Start work in Spark on a message or mention @
            {connection.botName}. The chat uses your default agent mode.
          </p>
        </div>
        <div>
          <label className="tk-switch">
            <BlobToggle
              size="sm"
              label="Reply in the thread when work starts, finishes or opens a PR"
              checked={settings.postUpdatesToThread}
              describedBy={`${id}-updates`}
              onChange={(next) => save.settings.mutate({ postUpdatesToThread: next })}
            />
            <span>Reply in the thread when work starts, finishes or opens a PR</span>
          </label>
          <p id={`${id}-updates`} className="tk-field-help">
            Only for chats started from Slack itself. The replies are fixed short lines, never agent
            text.
          </p>
        </div>
      </div>
      <AllowedUsers connection={connection} save={save} />
    </section>
  );
}
