import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PushState } from '@spark-outpost/contracts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { NOTIFY_NOT_ALLOWED } from './phone-copy.ts';
import {
  localPush,
  subscribe,
  subscribeRequest,
  subscribedWith,
  type LocalPush,
} from './push-browser.ts';

interface Change {
  state: PushState;
  local: LocalPush;
}

async function askBrowser(registration: ServiceWorkerRegistration, publicKey: string) {
  try {
    return await subscribe(registration, publicKey);
  } catch {
    throw new Error(NOTIFY_NOT_ALLOWED);
  }
}

async function turnOn(local: LocalPush, publicKey: string): Promise<Change> {
  const existing = local.subscription;
  const reusable = existing && subscribedWith(existing, publicKey) ? existing : null;
  if (existing && !reusable) await existing.unsubscribe();
  const subscription = reusable ?? (await askBrowser(local.registration, publicKey));
  const state = await phoneApi.subscribePush(subscribeRequest(subscription));
  return { state, local: { registration: local.registration, subscription } };
}

async function turnOff(local: LocalPush, state: PushState): Promise<Change> {
  const subscription = local.subscription;
  if (!subscription) return { state, local };
  const next = await phoneApi.unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
  return { state: next, local: { registration: local.registration, subscription: null } };
}

export function isPushOn(local: LocalPush | undefined, state: PushState | undefined): boolean {
  const subscription = local?.subscription;
  if (!subscription || !state) return false;
  return (
    state.endpoints.includes(subscription.endpoint) && subscribedWith(subscription, state.publicKey)
  );
}

export function useDevicePush(enabled: boolean) {
  const queryClient = useQueryClient();
  const server = useQuery({ queryKey: phoneKeys.push, queryFn: phoneApi.push, enabled });
  const local = useQuery({
    queryKey: phoneKeys.pushLocal,
    queryFn: localPush,
    enabled,
    staleTime: Infinity,
  });
  const change = useMutation({
    mutationFn: (next: boolean) => {
      if (!local.data || !server.data) throw new Error('Notifications are still loading.');
      return next ? turnOn(local.data, server.data.publicKey) : turnOff(local.data, server.data);
    },
    onSuccess: ({ state, local: nextLocal }) => {
      queryClient.setQueryData(phoneKeys.push, state);
      queryClient.setQueryData(phoneKeys.pushLocal, nextLocal);
    },
  });
  return {
    ready: server.data !== undefined && local.data !== undefined,
    loadError: server.error ?? local.error,
    on: isPushOn(local.data, server.data),
    change,
  };
}
