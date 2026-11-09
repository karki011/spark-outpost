import './pull-requests.css';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../../api/setup.ts';
import { PullRequestIcon } from '../rail/RailIcons.tsx';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import { PostOpenLines } from './PullOpenedLines.tsx';
import { openedIn } from './pull-request-model.ts';
import { useDismissedPulls } from './use-dismissed-pulls.ts';
import { followUpMode } from './use-watch-context.ts';

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
  const profile = useQuery({ queryKey: setupKey, queryFn: setupApi.get }).data?.profile ?? null;
  const [dismissed, dismiss] = useDismissedPulls(conversationId);
  const opened = watches.data ?? [];
  if (opened.length === 0) return null;
  const mode = profile ? followUpMode(profile) : 'on';
  return (
    <>
      {opened.map((watch) => (
        <div key={watch.id} className="pr-opened-lines">
          <p className="ai-note pr-opened">
            <PullRequestIcon />
            Opened pull request
            <a href={watch.url} target="_blank" rel="noopener noreferrer">
              #{watch.number}
            </a>
            <span className="pr-opened-repo">{watch.repo}</span>
          </p>
          <PostOpenLines watch={watch} mode={mode} dismissed={dismissed} onDismiss={dismiss} />
        </div>
      ))}
    </>
  );
}
