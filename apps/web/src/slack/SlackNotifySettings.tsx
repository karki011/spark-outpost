import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  slackNotifyEventSchema,
  slackNotifyLabels,
  slackUserIdSchema,
  type SlackConnection,
  type SlackNotifyEvent,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { slackApi } from './slack-api.ts';
import type { SlackSave } from './use-slack-save.ts';

const DIRECT = '';

const PREVIEW_LINES: Record<SlackNotifyEvent, string> = {
  needs_you: 'Needs your approval',
  finished: 'Finished',
  failed: 'Failed',
  pr_opened: 'Opened a pull request: https://github.com/acme/web/pull/128',
  flag: 'Flagged an action that crossed a guardrail',
};

function MemberField({ connection, save }: { connection: SlackConnection; save: SlackSave }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = slackUserIdSchema.safeParse(value.trim());
    if (!parsed.success) {
      setProblem('A member ID looks like U012AB3CD. In Slack: your profile → ⋯ → Copy member ID.');
      return;
    }
    setProblem(null);
    save.settings.mutate({ memberId: parsed.data }, { onSuccess: () => setValue('') });
  };
  return (
    <form className="tk-field" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-member`}>Your Slack member ID</label>
      <div className="tk-keyrow">
        <input
          id={`${id}-member`}
          className="inp mono"
          value={value}
          placeholder={connection.member?.id ?? 'U012AB3CD'}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-member-help`}
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
      <p id={`${id}-member-help`} className="tk-field-help">
        {connection.member
          ? `Spark sends direct messages to ${connection.member.name}.`
          : 'Spark needs this to message you directly. In Slack: your profile → ⋯ → Copy member ID. A user token fills it in for you.'}
      </p>
    </form>
  );
}

export function SlackNotifySettings({
  connection,
  save,
}: {
  connection: SlackConnection;
  save: SlackSave;
}) {
  const id = useId();
  const { settings } = connection;
  const test = useMutation({ mutationFn: slackApi.test });
  const channelChoices = [
    { id: DIRECT, label: 'A direct message to me' },
    ...connection.allowedChannels.map((channel) => ({ id: channel.id, label: `#${channel.name}` })),
  ];
  const lines = slackNotifyEventSchema.options.filter((event) => settings.notify[event]);
  const signedIn = connection.method === 'sign_in';

  return (
    <section className="sl-section" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Notify me in Slack</h4>
      {signedIn ? (
        <p className="tk-field-help">
          Notifications arrive as a message from you to yourself, in your own space in Slack. Slack
          may not alert you about a message you sent. A message from a bot, or to a channel, needs
          your own Slack app.
        </p>
      ) : (
        <>
          <MemberField connection={connection} save={save} />
          <div className="sl-row">
            <span>Send notifications to</span>
            <ChoicePicker
              label="Send notifications to"
              choices={channelChoices}
              value={settings.notifyChannelId ?? DIRECT}
              onChange={(channelId) => save.settings.mutate({ notifyChannelId: channelId || null })}
            />
          </div>
        </>
      )}
      <div className="tk-sync">
        {slackNotifyEventSchema.options.map((event) => (
          <div key={event}>
            <label className="tk-switch">
              <BlobToggle
                size="sm"
                label={slackNotifyLabels[event].label}
                checked={settings.notify[event]}
                describedBy={`${id}-${event}`}
                onChange={(next) => save.settings.mutate({ notify: { [event]: next } })}
              />
              <span>{slackNotifyLabels[event].label}</span>
            </label>
            <p id={`${id}-${event}`} className="tk-field-help">
              {slackNotifyLabels[event].hint}
            </p>
          </div>
        ))}
        <div>
          <label className="tk-switch">
            <BlobToggle
              size="sm"
              label="Stay quiet while I'm using Spark"
              checked={settings.quietWhenFocused}
              describedBy={`${id}-quiet`}
              onChange={(next) => save.settings.mutate({ quietWhenFocused: next })}
            />
            <span>Stay quiet while I&rsquo;m using Spark</span>
          </label>
          <p id={`${id}-quiet`} className="tk-field-help">
            Nothing is sent while the Spark window is in front.
          </p>
        </div>
      </div>
      <figure className="sl-preview" aria-label="Notification preview">
        <figcaption>Preview</figcaption>
        <p>
          <b>Fix the upload retry</b> · web-app
        </p>
        {lines.length === 0 ? (
          <p className="sl-empty">Every notification is off.</p>
        ) : (
          <ul>
            {lines.map((event) => (
              <li key={event}>{PREVIEW_LINES[event]}</li>
            ))}
          </ul>
        )}
        <p className="sl-link">Open in Spark</p>
      </figure>
      <p className="tk-field-help">
        Messages carry the chat title, project and a link that opens the chat. Never code, diffs,
        commands or secrets. Several events in one chat arrive as one message.
      </p>
      <div className="cx-actions">
        <button
          type="button"
          className="btn line sm"
          onClick={() => test.mutate()}
          disabled={test.isPending || !connection.capabilities.notify}
        >
          {test.isPending ? 'Sending…' : 'Send a test message'}
        </button>
        <span className="tk-check-say" role="status">
          {test.isSuccess ? `Sent to ${test.data.sentTo}.` : ''}
        </span>
      </div>
      {test.isError && (
        <p className="tk-field-err" role="alert">
          {test.error.message}
        </p>
      )}
    </section>
  );
}
