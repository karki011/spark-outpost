import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { routeToProvider } from '../providers/provider-route.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { homeApi, homeKeys } from './home-api.ts';
import { problemText } from './provider-status.ts';

interface ProviderNoticeProps {
  onSettings: () => void;
}

export function ProviderNotice({ onSettings }: ProviderNoticeProps) {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const health = useQuery({ queryKey: homeKeys.health, queryFn: homeApi.health });
  const issues = health.data?.issues ?? [];
  const connections = [...(setup.data?.providers ?? []), ...(setup.data?.advisors ?? [])];
  const troubled = connections.flatMap((entry) => {
    const issue = issues.find((candidate) => candidate.provider === entry.id) ?? null;
    const problem = problemText(entry.connection, issue, relativeTime);
    return problem ? [{ id: entry.id, name: entry.name, problem }] : [];
  });
  const first = troubled[0];
  const fix = () => {
    if (!first) return;
    routeToProvider(first.id);
    onSettings();
  };
  return (
    <>
      {health.data?.githubSignInNeeded && (
        <p className="ps-warn" role="status">
          <WarnIcon />
          <span className="ps-warn-text">GitHub: your sign-in ended</span>
          <button type="button" className="hlink" onClick={() => requestSettings('tools')}>
            Sign in again
          </button>
        </p>
      )}
      {first && (
        <p className="ps-warn" role="status">
          <WarnIcon />
          <span className="ps-warn-text">
            {first.name}: {first.problem}
            {troubled.length > 1 ? ` (+${troubled.length - 1} more)` : ''}
          </span>
          <button type="button" className="hlink" onClick={fix}>
            Fix
          </button>
        </p>
      )}
    </>
  );
}
