import { useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { SlackAllowedChannel, SlackConnection } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { slackApi, slackKeys } from './slack-api.ts';
import type { SlackSave } from './use-slack-save.ts';

const NO_PROJECT = '';
const NO_CHANNEL = '';

interface Listed {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean | null;
}

function channelLabel(channel: { name: string; isPrivate: boolean }): string {
  return channel.isPrivate ? `#${channel.name} (private)` : `#${channel.name}`;
}

function listed(allowed: readonly SlackAllowedChannel[], loaded: readonly Listed[]): Listed[] {
  const known = new Set(loaded.map((channel) => channel.id));
  const missing = allowed
    .filter((channel) => !known.has(channel.id))
    .map((channel) => ({ ...channel, isMember: null }));
  return [...missing, ...loaded];
}

export function SlackChannels({
  connection,
  save,
}: {
  connection: SlackConnection;
  save: SlackSave;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const pages = useInfiniteQuery({
    queryKey: slackKeys.channels,
    queryFn: ({ pageParam }) => slackApi.channels(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const allowed = connection.allowedChannels;
  const allowedIds = new Set(allowed.map((channel) => channel.id));
  const loaded = pages.data?.pages.flatMap((page) => page.channels) ?? [];
  const needle = search.trim().toLowerCase().replace(/^#/, '');
  const shown = listed(allowed, loaded).filter((channel) => channel.name.includes(needle));

  const replace = (next: { id: string; projectId: string | null }[]) =>
    save.channels.mutate({ channels: next });
  const current = allowed.map((channel) => ({ id: channel.id, projectId: channel.projectId }));
  const toggle = (channelId: string, on: boolean) =>
    replace(
      on
        ? [...current, { id: channelId, projectId: null }]
        : current.filter((channel) => channel.id !== channelId),
    );
  const setProject = (channelId: string, projectId: string) =>
    replace(
      current.map((channel) =>
        channel.id === channelId ? { ...channel, projectId: projectId || null } : channel,
      ),
    );

  const projectChoices = [
    { id: NO_PROJECT, label: 'No project' },
    ...(projects.data ?? []).map((project) => ({ id: project.id, label: project.name })),
  ];
  const channelChoices = [
    { id: NO_CHANNEL, label: 'None' },
    ...allowed.map((channel) => ({ id: channel.id, label: channelLabel(channel) })),
  ];

  return (
    <section className="sl-section" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>Allowed channels</h4>
      <p className="tk-field-help">
        Spark reads threads, searches and posts only in the channels you tick. Direct messages are
        never read.
      </p>
      <label className="sr-only" htmlFor={`${id}-search`}>
        Search channels
      </label>
      <input
        id={`${id}-search`}
        className="inp"
        type="search"
        placeholder="Search channels"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {pages.isError && (
        <p className="tk-field-err" role="alert">
          {pages.error.message}
        </p>
      )}
      <ul className="sl-channels" aria-label="Slack channels" aria-busy={pages.isPending}>
        {shown.map((channel) => {
          const on = allowedIds.has(channel.id);
          const mapped = allowed.find((entry) => entry.id === channel.id)?.projectId ?? NO_PROJECT;
          return (
            <li key={channel.id}>
              <label className="sl-channel">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={save.channels.isPending}
                  onChange={(event) => toggle(channel.id, event.target.checked)}
                />
                <span>{channelLabel(channel)}</span>
                {channel.isMember === false && <small>Invite the app to post here</small>}
              </label>
              {on && (
                <ChoicePicker
                  label={`Project for ${channel.name}`}
                  choices={projectChoices}
                  value={mapped}
                  placeholder="No project"
                  onChange={(projectId) => setProject(channel.id, projectId)}
                />
              )}
            </li>
          );
        })}
        {pages.isSuccess && shown.length === 0 && <li className="sl-empty">No channels match.</li>}
      </ul>
      {pages.hasNextPage && (
        <button
          type="button"
          className="btn line sm"
          onClick={() => void pages.fetchNextPage()}
          disabled={pages.isFetchingNextPage}
          aria-busy={pages.isFetchingNextPage}
        >
          Load more channels
        </button>
      )}
      <p className="tk-field-help">
        A project next to a channel is where work started from that channel runs.
      </p>
      <div className="sl-row">
        <span id={`${id}-default`}>Default channel for updates</span>
        <ChoicePicker
          label="Default channel for updates"
          choices={channelChoices}
          value={connection.settings.defaultChannelId ?? NO_CHANNEL}
          placeholder="None"
          onChange={(channelId) => save.settings.mutate({ defaultChannelId: channelId || null })}
        />
      </div>
    </section>
  );
}
