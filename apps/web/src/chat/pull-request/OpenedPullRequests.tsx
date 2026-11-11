import './pull-requests.css';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../../api/setup.ts';
import { PullRequestIcon } from '../rail/RailIcons.tsx';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import { openedSummary } from './post-open-model.ts';
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
  const summary = openedSummary(opened);
  return (
    <div className="pr-opened-lines">
      <p className="ai-note pr-opened">
        <PullRequestIcon />
        {summary.title}
        {opened.map((watch) => {
          const where = summary.sharedRepo === null ? `${watch.repo} #${watch.number}` : undefined;
          return (
            <a
              key={watch.id}
              href={watch.url}
              target="_blank"
              rel="noopener noreferrer"
              title={where}
              aria-label={where === undefined ? undefined : `#${watch.number} in ${watch.repo}`}
            >
              #{watch.number}
            </a>
          );
        })}
        {summary.sharedRepo !== null && (
          <span className="pr-opened-repo">{summary.sharedRepo}</span>
        )}
      </p>
      <PostOpenLines watches={opened} mode={mode} dismissed={dismissed} onDismiss={dismiss} />
    </div>
  );
}
