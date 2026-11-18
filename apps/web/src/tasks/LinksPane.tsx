import './task-panes.css';
import { Fragment, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskLink } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { FileIcon } from '../chat/attachments/attachment-icons.tsx';
import { prWatchesQuery } from '../chat/pull-request/pr-follow-up-api.ts';
import { PullRequestList } from '../chat/pull-request/PullRequestList.tsx';
import { useAdoptPull } from '../chat/project/adopt-api.ts';
import { useChatWorkspace } from '../chat/project/use-chat-workspace.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { FolderIcon, PlusIcon } from '../ui/icons.tsx';
import { taskApi, taskKeys } from './task-api.ts';
import { GitHubIcon, LinkIcon } from './TaskIcons.tsx';

const sourceNames: Record<TaskLink['source'], string> = {
  tool_output: 'From a tool',
  resource_link: 'Shared by the agent',
  agent_text: 'Mentioned by the agent',
  user: 'Added by you',
  ship: 'Opened in this chat',
  ticket: 'The ticket this task started from',
};

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

type ChipLink = Pick<TaskLink, 'kind' | 'url' | 'title' | 'source'>;

function FolderChip({ link }: { link: ChipLink }) {
  return (
    <div className="lchip" title={link.url}>
      <FolderIcon />
      <span className="t">
        <b>{link.title ?? link.url}</b>
        <small>
          <span>Folder · {link.url}</span>
        </small>
      </span>
    </div>
  );
}

function LinkChip({ link }: { link: ChipLink }) {
  if (link.kind === 'folder') return <FolderChip link={link} />;
  const href = link.kind === 'file' ? `/api${link.url}` : link.url;
  return (
    <a className="lchip" href={href} target="_blank" rel="noopener noreferrer">
      {link.kind === 'pr' ? <GitHubIcon /> : link.kind === 'file' ? <FileIcon /> : <LinkIcon />}
      <span className="t">
        <b>{link.title ?? shortUrl(link.url)}</b>
        <small>
          {link.kind === 'pr' && <span className="spill ok">Pull request</span>}
          <span>
            {link.kind === 'file' ? `File · ${sourceNames[link.source]}` : sourceNames[link.source]}
          </span>
        </small>
      </span>
    </a>
  );
}

const PULL_NUMBER = /\/pull\/(\d+)(?:[/?#]|$)/;

function pullNumber(url: string): number | null {
  const match = PULL_NUMBER.exec(url);
  return match ? Number(match[1]) : null;
}

function WorkOnPull({ conversationId, link }: { conversationId: string; link: ChipLink }) {
  const workspace = useChatWorkspace(conversationId).data;
  const { remote } = useRemoteClient();
  const projectId = workspace?.projectId ?? '';
  const adopt = useAdoptPull(conversationId, projectId);
  const number = pullNumber(link.url);
  const current = workspace?.current ?? null;
  if (remote || !number || !workspace?.projectId || workspace.place !== 'worktree') return null;
  if (current && !current.worktree) return null;
  const done = current?.adopted?.number === number;
  if (done && !adopt.data) return null;
  return (
    <div className="lwork">
      {!done && (
        <button
          type="button"
          className="btn line sm"
          aria-label={`Work on pull request #${number} in this chat`}
          disabled={adopt.isPending}
          onClick={() => adopt.mutate({ number, url: link.url })}
        >
          Work on it here
        </button>
      )}
      {adopt.data && (
        <p className="wnote" role="status">
          {adopt.data.note}
        </p>
      )}
      {adopt.error && (
        <p className="wnote bad" role="alert">
          {adopt.error.message}
        </p>
      )}
    </div>
  );
}

interface LinksPaneProps {
  taskId: string;
  conversationId: string;
  links: readonly TaskLink[];
}

export function LinksPane({ taskId, conversationId, links }: LinksPaneProps) {
  const queryClient = useQueryClient();
  const watches = useQuery(prWatchesQuery(conversationId)).data?.watches ?? [];
  const tracked = new Set(watches.map((watch) => watch.url));
  const others = links.filter((link) => !(link.kind === 'pr' && tracked.has(link.url)));
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const add = useMutation({
    mutationFn: (value: string) => taskApi.addLink(taskId, { url: value }),
    onSuccess: async () => {
      setUrl('');
      setAdding(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.task(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
      ]);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    if (value) add.mutate(value);
  };

  return (
    <div className="wsec">
      {links.length === 0 && watches.length === 0 && (
        <p className="wnote first">
          No links yet. Pull requests and the links, files and folders you add show up here.
        </p>
      )}
      <PullRequestList conversationId={conversationId} watches={watches} />
      {others.map((link) => (
        <Fragment key={link.id}>
          <LinkChip link={link} />
          {link.kind === 'pr' && <WorkOnPull conversationId={conversationId} link={link} />}
        </Fragment>
      ))}
      {adding ? (
        <form className="linkform" onSubmit={submit}>
          <input
            className="inp linkin"
            type="url"
            inputMode="url"
            placeholder="https://github.com/owner/repo/pull/1"
            aria-label="Link URL"
            value={url}
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(false);
            }}
          />
          <button type="submit" className="btn primary sm" disabled={add.isPending || !url.trim()}>
            Add
          </button>
          {add.error && (
            <p className="wnote bad" role="alert">
              {add.error.message}
            </p>
          )}
        </form>
      ) : (
        <button type="button" className="addlink" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add link
        </button>
      )}
    </div>
  );
}
