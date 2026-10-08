import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import { AgentExitedError } from './agent-process.ts';
import { toProviderError } from './errors.ts';
import { failureText } from './provider-failures.ts';

export type SignInCheck = () => Promise<boolean | null>;

export async function exitCause(
  agentName: string,
  cause: unknown,
  stderrTail: string,
  turn: Pick<ProviderTurn, 'settings'>,
  signedIn: SignInCheck | undefined,
): Promise<Error> {
  if (cause instanceof AgentExitedError && signedIn && turn.settings.method === 'cli') {
    const answer = await signedIn().catch(() => null);
    if (answer === false) return new ProviderError(failureText('auth', agentName));
  }
  return toProviderError(agentName, cause, stderrTail);
}
