import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteSession } from '@spark-outpost/contracts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { activationOf, turnFailure } from './pair-flow.ts';
import { PairPhone } from './PairPhone.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { PhoneActivity } from './PhoneActivity.tsx';
import { PhoneDevices } from './PhoneDevices.tsx';
import { PhoneStatus } from './PhoneStatus.tsx';
import { PhoneSwitches } from './PhoneSwitches.tsx';
import { PushContact } from './PushContact.tsx';

const STATE_POLL_MS = 10_000;
const LIST_POLL_MS = 5000;
const FRESH_MS = 9000;

export function MacPhonePage({ session }: { session: RemoteSession }) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const [freshAfter, setFreshAfter] = useState<number | null>(null);
  const tailscale = useQuery({
    queryKey: phoneKeys.tailscale,
    queryFn: phoneApi.tailscale,
    refetchInterval: hidden ? false : STATE_POLL_MS,
  });
  const listPoll = hidden ? false : freshAfter === null ? LIST_POLL_MS : 1000;
  const devices = useQuery({
    queryKey: phoneKeys.devices,
    queryFn: phoneApi.devices,
    refetchInterval: listPoll,
  });
  const audit = useQuery({
    queryKey: phoneKeys.audit,
    queryFn: phoneApi.audit,
    refetchInterval: hidden ? false : LIST_POLL_MS,
  });
  const turn = useMutation({
    mutationFn: phoneApi.turn,
    onSuccess: (next) => {
      if (next.status !== 'error') queryClient.setQueryData(phoneKeys.tailscale, next);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.all });
    },
  });
  const failure = turnFailure(turn.error, turn.data);

  useEffect(() => {
    if (freshAfter === null) return;
    const timer = setTimeout(() => setFreshAfter(null), FRESH_MS);
    return () => clearTimeout(timer);
  }, [freshAfter]);

  if (!tailscale.data) {
    return (
      <QueryWait query={tailscale} what="remote control">
        <Skeleton label="Loading remote control" shape="cards" rows={3} />
      </QueryWait>
    );
  }
  const list = devices.data ?? [];
  const active = list.filter((device) => !device.revokedAt);
  return (
    <>
      <PhoneStatus
        state={tailscale.data}
        wanted={session.address !== null}
        connected={active.some((device) => device.connected)}
        deviceCount={devices.data ? active.length : null}
        checking={tailscale.isFetching}
        turning={turn.isPending}
        failure={failure}
        onCheck={() => void tailscale.refetch()}
        onTurn={(to) => turn.mutate(to)}
      />
      <div className="ph-cols">
        <div className="ph-area ph-area-pair">
          <PairPhone
            tailscale={tailscale.data}
            activation={activationOf(
              {
                pending: turn.isPending ? (turn.variables ?? null) : null,
                failed: failure === null ? null : (turn.variables ?? null),
              },
              tailscale.data,
            )}
            onPaired={() => {
              setFreshAfter(Date.now());
              void queryClient.invalidateQueries({ queryKey: phoneKeys.devices });
            }}
          />
        </div>
        <div className="ph-area ph-area-main">
          <PhoneDevices
            devices={devices.data}
            freshAfter={freshAfter}
            passkeysAllowed={session.switches.passkeys}
            wait={
              <QueryWait query={devices} what="devices">
                <Skeleton label="Loading devices" shape="list" rows={2} />
              </QueryWait>
            }
          />
          <PhoneSwitches
            switches={session.switches}
            notificationsExtra={<PushContact poll={hidden ? false : LIST_POLL_MS} />}
          />
        </div>
        <div className="ph-area ph-area-activity">
          <PhoneActivity
            entries={audit.data}
            wait={
              <QueryWait query={audit} what="remote activity">
                <Skeleton label="Loading remote activity" shape="list" rows={3} />
              </QueryWait>
            }
          />
        </div>
      </div>
    </>
  );
}
