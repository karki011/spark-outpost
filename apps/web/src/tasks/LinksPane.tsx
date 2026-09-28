import './task-panes.css';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskLink } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { PlusIcon } from '../ui/icons.tsx';
import { taskApi, taskKeys } from './task-api.ts';
import { GitHubIcon, LinkIcon } from './TaskIcons.tsx';

const sourceNames: Record<TaskLink['source'], string> = {
  tool_output: 'From a tool',
  resource_link: 'Shared by the agent',
  agent_text: 'Mentioned by the agent',
  user: 'Added by you',
  ship: 'Opened by Ship',
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

export function LinkChip({ link }: { link: Pick<TaskLink, 'kind' | 'url' | 'title' | 'source'> }) {
  return (
    <a className="lchip" href={link.url} target="_blank" rel="noopener noreferrer">
      {link.kind === 'pr' ? <GitHubIcon /> : <LinkIcon />}
      <span className="t">
        <b>{link.title ?? shortUrl(link.url)}</b>
        <small>
          {link.kind === 'pr' && <span className="spill ok">Pull request</span>}
          <span>{sourceNames[link.source]}</span>
        </small>
      </span>
    </a>
  );
}

interface LinksPaneProps {
  taskId: string;
  conversationId: string;
  links: readonly TaskLink[];
}

export function LinksPane({ taskId, conversationId, links }: LinksPaneProps) {
  const queryClient = useQueryClient();
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
      {links.length === 0 && (
        <p className="wnote first">No links yet. Pull requests show up here.</p>
      )}
      {links.map((link) => (
        <LinkChip key={link.id} link={link} />
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
