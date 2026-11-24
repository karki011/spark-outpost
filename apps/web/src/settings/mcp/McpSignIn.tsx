import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { McpSignInFlow, UserMcpServer } from '@spark-outpost/contracts';
import { mcpApi, mcpSignInKey, userMcpKey } from '../../api/mcp.ts';
import { openOutside, outsideTarget } from '../../browser/outside-link.ts';
import { ExternalLinkIcon } from '../../ui/icons.tsx';
import { useMcpChange } from './use-mcp.ts';

const POLL_MS = 1500;

export const MCP_SIGNED_IN_LINE =
  'Signed in. Spark keeps the sign-in in your keychain and renews it, so you sign in once.';
export const MCP_SIGN_IN_NEEDED_LINE = 'This server asks you to sign in before agents can use it.';

function useSignIn(serverId: string) {
  const queryClient = useQueryClient();
  const key = mcpSignInKey(serverId);
  const flow = useQuery({
    queryKey: key,
    queryFn: () => mcpApi.signInFlow(serverId),
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? POLL_MS : false),
  });
  const status = flow.data?.status;
  useEffect(() => {
    if (status === 'connected') void queryClient.invalidateQueries({ queryKey: userMcpKey });
  }, [status, queryClient]);
  const setFlow = (next: McpSignInFlow) => queryClient.setQueryData(key, next);
  const start = useMutation({
    mutationFn: () => mcpApi.startSignIn(serverId),
    onSuccess: (next) => {
      setFlow(next);
      if (next.authorizeUrl) openOutside(next.authorizeUrl);
    },
  });
  const cancel = useMutation({
    mutationFn: () => mcpApi.cancelSignIn(serverId),
    onSuccess: setFlow,
  });
  return { flow: flow.data ?? null, start, cancel };
}

export function McpSignIn({ server }: { server: UserMcpServer }) {
  const { flow, start, cancel } = useSignIn(server.id);
  const signOut = useMcpChange(() => mcpApi.signOut(server.id));
  const waiting = flow?.status === 'waiting';
  const signedIn = server.signIn === 'signed_in';
  const line = signedIn
    ? MCP_SIGNED_IN_LINE
    : server.signIn === 'needed'
      ? MCP_SIGN_IN_NEEDED_LINE
      : null;
  const problem =
    (flow?.status === 'failed' ? flow.message : null) ??
    start.error?.message ??
    signOut.error?.message ??
    null;
  return (
    <div className="mcp-sign-in" role="group" aria-label={`Sign-in for ${server.name}`}>
      {line && <p className="mcp-sign-in-line">{line}</p>}
      {waiting ? (
        <>
          <p className="mcp-sign-in-line" role="status">
            Waiting for you to finish signing in in your browser.
          </p>
          <div className="mcp-actions">
            {flow.authorizeUrl && (
              <a
                className="btn line sm"
                href={flow.authorizeUrl}
                target={outsideTarget()}
                rel="noreferrer"
              >
                Open sign-in again
                <ExternalLinkIcon />
              </a>
            )}
            <button type="button" className="btn ghost sm" onClick={() => cancel.mutate()}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="mcp-actions">
          {!signedIn && (
            <button
              type="button"
              className={server.signIn === 'needed' ? 'btn primary sm' : 'btn ghost sm'}
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              Sign in
            </button>
          )}
          {signedIn && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate(undefined)}
            >
              Sign out
            </button>
          )}
        </div>
      )}
      {problem && (
        <p className="mcp-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
