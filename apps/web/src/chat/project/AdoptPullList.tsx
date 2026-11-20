import './adopt-pull.css';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OpenPull } from '@spark-outpost/contracts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { PullRequestIcon } from '../rail/RailIcons.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { adoptApi, adoptKeys, useAdoptPull } from './adopt-api.ts';

export const ADOPT_LABEL = 'Work on a pull request…';

function pullFacts(pull: OpenPull): string {
  const where = `${pull.head} → ${pull.base}`;
  if (!pull.fork) return `@${pull.author} · ${where}`;
  const fork = pull.maintainerCanModify ? 'fork' : 'fork, works on its own branch';
  return `@${pull.author} · ${where} · ${fork}`;
}

interface AdoptPullListProps {
  conversationId: string;
  projectId: string;
  switchesFrom?: string | null;
}

export function AdoptPullList({
  conversationId,
  projectId,
  switchesFrom = null,
}: AdoptPullListProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { remote } = useRemoteClient();
  const pulls = useQuery({
    queryKey: adoptKeys.open(projectId),
    queryFn: () => adoptApi.open(projectId),
    enabled: open,
  });
  const adopt = useAdoptPull(conversationId, projectId);
  if (remote) return null;
  const list = pulls.data?.pulls ?? [];
  return (
    <div className="adopt">
      <button
        type="button"
        className="adopt-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((shown) => !shown)}
      >
        <PullRequestIcon />
        <span>{ADOPT_LABEL}</span>
        <ChevronIcon />
      </button>
      <div id={listId} className="adopt-list" hidden={!open}>
        {pulls.isPending && open && (
          <Skeleton label="Listing open pull requests" shape="list" rows={3} />
        )}
        {pulls.data?.problem && <p className="mempty">{pulls.data.problem}</p>}
        {pulls.data && !pulls.data.problem && list.length === 0 && (
          <p className="mempty">No open pull requests.</p>
        )}
        {list.length > 0 && (
          <ul aria-label="Open pull requests">
            {list.map((pull) => (
              <li key={pull.number}>
                <button
                  type="button"
                  className="adopt-row"
                  disabled={adopt.isPending}
                  onClick={() => adopt.mutate({ number: pull.number })}
                >
                  <b>
                    #{pull.number} {pull.title}
                  </b>
                  <small>{pullFacts(pull)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="adopt-hint">
          {switchesFrom
            ? `This chat switches to its branch; earlier work stays on ${switchesFrom}. Commit or discard changes first.`
            : 'The chat checks out its branch and may push to it, never force. Nothing merges.'}
        </p>
        {adopt.data && (
          <p className="adopt-done" role="status">
            {adopt.data.note}
          </p>
        )}
        {(adopt.isError || pulls.isError) && (
          <p className="mpop-error" role="alert">
            {(adopt.error ?? pulls.error)?.message}
          </p>
        )}
      </div>
    </div>
  );
}
