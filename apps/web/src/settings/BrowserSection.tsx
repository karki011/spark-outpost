import '../browser/browser-pane.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { DocLink } from '../ui/DocLink.tsx';

export const SIGNED_IN_SITES_LABEL = 'Signed-in sites';
export const SIGN_OUT_ALL_LABEL = 'Sign out of everything';

const SITES_KEY = ['browser-sites'] as const;

export function browserSettingsAvailable(): boolean {
  return desktopBrowser() !== null;
}

function SignedInSites() {
  const queryClient = useQueryClient();
  const browser = desktopBrowser();
  const sites = useQuery({
    queryKey: SITES_KEY,
    queryFn: async () => (await browser?.sites()) ?? [],
    enabled: browser !== null,
  });
  const signOut = useMutation({
    mutationFn: async (origin: string | null) => (await browser?.signOut(origin)) ?? [],
    onSuccess: (left) => queryClient.setQueryData(SITES_KEY, left),
  });
  if (!browser || !sites.data) return null;
  if (sites.data.length === 0) {
    return <p className="set-hint">No signed-in sites.</p>;
  }
  return (
    <div className="set-sites" role="group" aria-label={SIGNED_IN_SITES_LABEL}>
      <p className="set-hint">{SIGNED_IN_SITES_LABEL}</p>
      <ul className="set-site-list">
        {sites.data.map((site) => (
          <li key={site.origin}>
            <code>{site.origin}</code>
            <button
              type="button"
              className="btn ghost sm"
              disabled={signOut.isPending}
              aria-label={`Sign out of ${site.origin}`}
              onClick={() => signOut.mutate(site.origin)}
            >
              Sign out
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn line sm"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate(null)}
      >
        {SIGN_OUT_ALL_LABEL}
      </button>
    </div>
  );
}

export function BrowserSection() {
  const { remote } = useRemoteClient();
  if (remote) return <p className="lede">The Browser pane is available on your Mac.</p>;
  return (
    <>
      <p className="lede">
        One browser profile for every chat and project, kept on this Mac. A site you or an agent
        sign in to in the Browser pane stays signed in everywhere, and agent tabs use it too.{' '}
        <DocLink topic="Browser pane" doc={{ page: 'use-the-browser' }} />
      </p>
      <SignedInSites />
    </>
  );
}
