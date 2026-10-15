import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PushState } from '@spark-outpost/contracts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { NOTIFY_FAILED, NOTIFY_NOT_ALLOWED } from './phone-copy.ts';
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

interface Turn {
  next: boolean;
  asked: Promise<PushSubscription> | null;
}

async function answerOf(asked: Promise<PushSubscription>): Promise<PushSubscription> {
  try {
    return await asked;
  } catch (error) {
    const refused = error instanceof Error && error.name === 'NotAllowedError';
    throw new Error(refused ? NOTIFY_NOT_ALLOWED : NOTIFY_FAILED, { cause: error });
  }
}

function reusable(local: LocalPush, publicKey: string): PushSubscription | null {
  const existing = local.subscription;
  return existing && subscribedWith(existing, publicKey) ? existing : null;
}

async function turnOn(
  local: LocalPush,
  publicKey: string,
  asked: Promise<PushSubscription> | null,
): Promise<Change> {
  let subscription = reusable(local, publicKey);
  if (!subscription) {
    await local.subscription?.unsubscribe();
    subscription = await answerOf(asked ?? subscribe(local.registration, publicKey));
  }
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
    mutationFn: ({ next, asked }: Turn) => {
      if (!local.data || !server.data) throw new Error(NOTIFY_FAILED);
      return next
        ? turnOn(local.data, server.data.publicKey, asked)
        : turnOff(local.data, server.data);
    },
    onSuccess: ({ state, local: nextLocal }) => {
      queryClient.setQueryData(phoneKeys.push, state);
      queryClient.setQueryData(phoneKeys.pushLocal, nextLocal);
    },
  });
  const turn = (next: boolean) => {
    if (change.isPending) return;
    const fresh =
      next && local.data && server.data && !local.data.subscription
        ? subscribe(local.data.registration, server.data.publicKey)
        : null;
    fresh?.catch(() => undefined);
    change.mutate({ next, asked: fresh });
  };
  return {
    ready: server.data !== undefined && local.data !== undefined,
    loadError: server.error ?? local.error,
    on: isPushOn(local.data, server.data),
    pending: change.isPending ? change.variables.next : null,
    error: change.error,
    turn,
  };
}
