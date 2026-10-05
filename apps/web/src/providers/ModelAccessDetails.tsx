import { useQuery } from '@tanstack/react-query';
import type { ProviderAccess, ProviderId } from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { Detail } from './Detail.tsx';

export function modelCountText(access: ProviderAccess): string {
  const blocked = access.unusable.map((model) => model.label);
  const parts = [
    access.reported ? `${access.usable} usable` : null,
    access.unknown > 0 ? `${access.unknown} not confirmed` : null,
    blocked.length > 0 ? `${blocked.length} unavailable (${blocked.join(', ')})` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'None reported';
}

export function ModelAccessDetails({ provider }: { provider: ProviderId }) {
  const capabilities = useQuery({
    ...capabilitiesQuery(provider),
    staleTime: CAPABILITIES_STALE_MS,
    retry: false,
  });
  const access = capabilities.data?.access;
  if (!access) return null;
  return (
    <>
      {access.account && <Detail term="Account">{access.account.label}</Detail>}
      <Detail term="Models">{modelCountText(access)}</Detail>
    </>
  );
}
