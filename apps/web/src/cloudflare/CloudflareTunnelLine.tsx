import { useQuery } from '@tanstack/react-query';
import type { CloudflareReach } from '@spark-outpost/contracts';
import { CheckIcon, WarnIcon } from '../ui/icons.tsx';
import { cloudflareApi, cloudflareKeys } from './cloudflare-api.ts';

const POLL_MS = 5000;

export const TUNNEL_WORDS: Record<CloudflareReach['tunnel'], string> = {
  running: 'Connected',
  starting: 'Connecting…',
  stopped: 'Not connected. Spark keeps trying.',
  off: 'Not running',
};
export const TUNNEL_KEPT =
  'Spark runs the tunnel while it is open. Turn off stops it and deletes its key from this computer; the tunnel, DNS record and sign-in page stay in your Cloudflare account.';

export function CloudflareTunnelLine({ hostname }: { hostname: string }) {
  const reach = useQuery({
    queryKey: cloudflareKeys.reach,
    queryFn: cloudflareApi.reach,
    refetchInterval: POLL_MS,
  });
  if (reach.data?.connected !== hostname) return null;
  const tunnel = reach.data.tunnel;
  return (
    <div className="cf-tunnel">
      <p className="cf-tunnel-state" role="status">
        {tunnel === 'running' ? <CheckIcon /> : <WarnIcon />}
        <span>Cloudflare Tunnel: {TUNNEL_WORDS[tunnel]}</span>
      </p>
      <p className="ph-step">{TUNNEL_KEPT}</p>
    </div>
  );
}
