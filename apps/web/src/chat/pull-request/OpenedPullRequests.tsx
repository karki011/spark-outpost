import './pull-requests.css';
import { useQuery } from '@tanstack/react-query';
import { PullRequestIcon } from '../rail/RailIcons.tsx';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import { openedIn } from './pull-request-model.ts';

interface OpenedPullRequestsProps {
  conversationId: string;
  runIds: readonly string[];
}

export function OpenedPullRequests({ conversationId, runIds }: OpenedPullRequestsProps) {
  const watches = useQuery({
    ...prWatchesQuery(conversationId),
    select: (list) => openedIn(list.watches, runIds),
    notifyOnChangeProps: ['data'],
  });
  const opened = watches.data ?? [];
  if (opened.length === 0) return null;
  return (
    <>
      {opened.map((watch) => (
        <p key={watch.id} className="ai-note pr-opened">
          <PullRequestIcon />
          Opened pull request
          <a href={watch.url} target="_blank" rel="noopener noreferrer">
            #{watch.number}
          </a>
          <span className="pr-opened-repo">{watch.repo}</span>
        </p>
      ))}
    </>
  );
}
