import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SLACK_USER_SCOPES, type SlackConnection, type SlackDm } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CopyManifest } from './SlackConnectForm.tsx';
import { slackApi, slackKeys } from './slack-api.ts';
import type { SlackSave } from './use-slack-save.ts';

const SWITCH_LABEL = 'Let Spark read my direct messages';

function listed(allowed: readonly SlackDm[], loaded: readonly SlackDm[]): SlackDm[] {
  const known = new Set(loaded.map((conversation) => conversation.id));
  return [...allowed.filter((conversation) => !known.has(conversation.id)), ...loaded];
}

function UpdateAppSteps({ missing, save }: { missing: readonly string[]; save: SlackSave }) {
  const id = useId();
  return (
    <div className="sl-update" role="group" aria-labelledby={`${id}-title`}>
      <h5 id={`${id}-title`}>Update the Slack app to allow direct messages</h5>
      <p className="tk-field-help">
        Your app was installed before Spark could read direct messages. It needs these permissions
        on the user token:
      </p>
      <ul className="sl-scopes" aria-label="Permissions to add">
        {missing.map((scope) => (
          <li key={scope}>
            <code>{scope}</code> {SLACK_USER_SCOPES[scope as keyof typeof SLACK_USER_SCOPES]}
          </li>
        ))}
      </ul>
      <ol className="sl-steps" aria-label="Update your Slack app">
        <li>
          <CopyManifest label="Copy updated manifest" />
        </li>
        <li>
          In Slack, open your app, choose <b>App Manifest</b>, paste over the old one and select{' '}
          <b>Save Changes</b>.
        </li>
        <li>
          Under <b>OAuth &amp; Permissions</b>, select <b>Reinstall to Workspace</b> and allow it.
        </li>
        <li>
          If Slack shows a new User OAuth Token, paste it with <b>Change tokens</b> below. Then
          select <b>Check again</b>.
        </li>
      </ol>
      <div className="cx-actions">
        <button
          type="button"
          className="btn line sm"
          onClick={() => save.scopes.mutate()}
          disabled={save.scopes.isPending}
        >
          {save.scopes.isPending ? 'Checking…' : 'Check again'}
        </button>
        <span className="tk-check-say" role="status">
          {save.scopes.isSuccess ? 'Still missing. Reinstall the app in Slack first.' : ''}
        </span>
      </div>
    </div>
  );
}

function Picker({ connection, save }: { connection: SlackConnection; save: SlackSave }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const pages = useInfiniteQuery({
    queryKey: slackKeys.directMessages,
    queryFn: ({ pageParam }) => slackApi.directMessages(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const { allowed } = connection.directMessages;
  const all = connection.settings.allDirectMessages;
  const allowedIds = new Set(allowed.map((conversation) => conversation.id));
  const loaded = pages.data?.pages.flatMap((page) => page.conversations) ?? [];
  const needle = search.trim().toLowerCase();
  const shown = listed(allowed, loaded).filter((conversation) =>
    conversation.name.toLowerCase().includes(needle),
  );
  const busy = save.directMessages.isPending || save.settings.isPending;
  const toggle = (conversationId: string, on: boolean) => {
    const kept = allowed.filter((conversation) => conversation.id !== conversationId);
    save.directMessages.mutate({
      conversations: [...kept, ...(on ? [{ id: conversationId }] : [])].map((conversation) => ({
        id: conversation.id,
      })),
    });
  };

  return (
    <>
      <label className="sl-channel sl-all">
        <input
          type="checkbox"
          checked={all}
          disabled={busy}
          aria-describedby={`${id}-all`}
          onChange={(event) => save.settings.mutate({ allDirectMessages: event.target.checked })}
        />
        <span>All my direct messages</span>
      </label>
      <p id={`${id}-all`} className="tk-field-help">
        Every direct and group message you can see, including ones that start later. Leave this off
        to keep to the conversations you tick.
      </p>
      <label className="sr-only" htmlFor={`${id}-search`}>
        Search direct messages
      </label>
      <input
        id={`${id}-search`}
        className="inp"
        type="search"
        placeholder="Search direct messages"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {pages.isError && (
        <p className="tk-field-err" role="alert">
          {pages.error.message}
        </p>
      )}
      <ul className="sl-channels" aria-label="Slack direct messages" aria-busy={pages.isPending}>
        {shown.map((conversation) => (
          <li key={conversation.id}>
            <label className="sl-channel">
              <input
                type="checkbox"
                checked={all || allowedIds.has(conversation.id)}
                disabled={busy || all}
                onChange={(event) => toggle(conversation.id, event.target.checked)}
              />
              <span>{conversation.name}</span>
              {conversation.kind === 'mpim' && <small>Group message</small>}
            </label>
          </li>
        ))}
        {pages.isSuccess && shown.length === 0 && (
          <li className="sl-empty">No direct messages match.</li>
        )}
      </ul>
      {pages.hasNextPage && (
        <button
          type="button"
          className="btn line sm"
          onClick={() => void pages.fetchNextPage()}
          disabled={pages.isFetchingNextPage}
          aria-busy={pages.isFetchingNextPage}
        >
          Load more direct messages
        </button>
      )}
    </>
  );
}

export function SlackDirectMessages({
  connection,
  save,
}: {
  connection: SlackConnection;
  save: SlackSave;
}) {
  const id = useId();
  const { blockedBy, missingScopes } = connection.directMessages;
  const on = connection.settings.readDirectMessages;
  return (
    <section className="sl-section" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Direct messages</h4>
      {blockedBy === 'scopes' && <UpdateAppSteps missing={missingScopes} save={save} />}
      <div>
        <label className="tk-switch">
          <BlobToggle
            size="sm"
            label={SWITCH_LABEL}
            checked={on}
            disabled={(blockedBy !== null && !on) || save.settings.isPending}
            describedBy={`${id}-help`}
            onChange={(next) => save.settings.mutate({ readDirectMessages: next })}
          />
          <span>{SWITCH_LABEL}</span>
        </label>
        <p id={`${id}-help`} className="tk-field-help">
          {blockedBy === 'user_token'
            ? 'This needs a user token (xoxp-): the app is not in your direct messages, so Spark reads them as you. Add one with Change tokens.'
            : 'Off unless you turn it on. Spark then reads only the conversations you tick, as you, when you paste a link or an agent looks one up. It never posts in a one-to-one message, and turning this off forgets your choices.'}
        </p>
      </div>
      {on && blockedBy === null && <Picker connection={connection} save={save} />}
    </section>
  );
}
