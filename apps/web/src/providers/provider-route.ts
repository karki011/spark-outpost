import { useSyncExternalStore } from 'react';
import { connectableIdSchema, type ConnectableId } from '@spark-outpost/contracts';

const PREFIX = '#/settings/providers';

export interface ProviderRoute {
  providerId: ConnectableId | null;
}

export function parseProviderRoute(hash: string): ProviderRoute | null {
  if (hash !== PREFIX && !hash.startsWith(`${PREFIX}/`)) return null;
  const rest = decodeURIComponent(hash.slice(PREFIX.length + 1)).replace(/\/$/, '');
  if (!rest) return { providerId: null };
  const parsed = connectableIdSchema.safeParse(rest);
  return { providerId: parsed.success ? parsed.data : null };
}

export function providerRouteHash(providerId: ConnectableId | null): string {
  return providerId ? `${PREFIX}/${providerId}` : PREFIX;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('hashchange', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('hashchange', onChange);
  };
}

function replaceHash(hash: string) {
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${hash}`,
  );
  notify();
}

export function currentProviderRoute(): ProviderRoute | null {
  return parseProviderRoute(window.location.hash);
}

function routedProviderId(): ConnectableId | null {
  return currentProviderRoute()?.providerId ?? null;
}

export function useRoutedProvider(): ConnectableId | null {
  return useSyncExternalStore(subscribe, routedProviderId);
}

export function routeToProvider(providerId: ConnectableId | null): void {
  replaceHash(providerRouteHash(providerId));
}

export function leaveProviderRoute(): void {
  if (currentProviderRoute()) replaceHash('');
}
