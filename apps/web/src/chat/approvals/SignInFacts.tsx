import { useQuery } from '@tanstack/react-query';
import type { BrowserSignInAction } from '@spark-outpost/contracts';
import { signInKeys, signInsApi } from '../../api/sign-ins.ts';

function usernameOf(
  action: BrowserSignInAction,
  saved: Awaited<ReturnType<typeof signInsApi.list>> | undefined,
  failed: boolean,
): string {
  if (failed) return 'Could not be read from the keychain';
  if (!saved) return 'Reading…';
  const signIn = saved.find((candidate) => candidate.id === action.signInId);
  if (!signIn) return 'No longer saved';
  return signIn.username ?? 'Missing from the keychain';
}

export function SignInFacts({ action }: { action: BrowserSignInAction }) {
  const saved = useQuery({
    queryKey: signInKeys.project(action.projectId),
    queryFn: () => signInsApi.list(action.projectId),
  });
  return (
    <dl className="sac-facts">
      <dt>Site</dt>
      <dd>
        <code>{action.origin}</code>
      </dd>
      <dt>Sign-in</dt>
      <dd>{action.label}</dd>
      <dt>Username</dt>
      <dd>{usernameOf(action, saved.data, saved.isError)}</dd>
    </dl>
  );
}
