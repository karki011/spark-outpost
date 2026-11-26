import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteSession } from '@spark-outpost/contracts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { activationOf, turnFailure } from './pair-flow.ts';
import { PairPhone } from './PairPhone.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { PhoneActivity } from './PhoneActivity.tsx';
import { PhoneDevices } from './PhoneDevices.tsx';
import { PhoneRail } from './PhoneRail.tsx';
import { PhoneStatus } from './PhoneStatus.tsx';
import { PhoneSwitches } from './PhoneSwitches.tsx';
import { PhoneCardAnswering } from './PhoneCardAnswering.tsx';
import { PushContact } from './PushContact.tsx';
import { setupSteps } from './setup-steps.ts';
import { OtherSparks } from '../remote-sparks/OtherSparks.tsx';
import { hostWords } from '../desktop/host-words.ts';

const STATE_POLL_MS = 10_000;
const LIST_POLL_MS = 5000;
const FRESH_MS = 9000;

export function MacPhonePage({ session }: { session: RemoteSession }) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const now = useMinuteClock();
  const [freshAfter, setFreshAfter] = useState<number | null>(null);
  const inboundTitle = useId();
  const outboundTitle = useId();
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
  const state = tailscale.data;
  const setup = setupSteps(state.status) !== null;
  const wanted = session.address !== null;
  const pair = (
    <PairPhone
      tailscale={state}
      activation={activationOf(
        {
          pending: turn.isPending ? (turn.variables ?? null) : null,
          failed: failure === null ? null : (turn.variables ?? null),
        },
        state,
      )}
      onPaired={() => {
        setFreshAfter(Date.now());
        void queryClient.invalidateQueries({ queryKey: phoneKeys.devices });
      }}
    />
  );
  return (
    <div className="ph-cols" data-setup={setup || undefined}>
      {setup ? (
        <div className="ph-area ph-area-setup">
          <PhoneStatus
            state={state}
            checking={tailscale.isFetching}
            turning={turn.isPending}
            on={state.status === 'on' || (state.status === 'error' && wanted)}
            failure={failure}
            onCheck={() => void tailscale.refetch()}
            onTurn={(to) => turn.mutate(to)}
          />
        </div>
      ) : (
        <PhoneRail
          state={state}
          wanted={wanted}
          devices={devices.data}
          switches={session.switches}
          lastRequest={audit.data?.[0]?.at ?? null}
          turning={turn.isPending}
          failure={failure}
          onTurn={(to) => turn.mutate(to)}
        />
      )}
      <div className="ph-area ph-area-main">
        <div className="ph-zone" role="group" aria-labelledby={inboundTitle}>
          <p id={inboundTitle} className="ph-zone-title">
            Control this {hostWords().computer}
          </p>
          <PhoneDevices
            devices={devices.data}
            freshAfter={freshAfter}
            passkeysAllowed={session.switches.passkeys}
            pair={pair}
            wait={
              <QueryWait query={devices} what="devices">
                <Skeleton label="Loading devices" shape="list" rows={2} />
              </QueryWait>
            }
          />
          <PhoneSwitches
            switches={session.switches}
            notificationsExtra={<PushContact poll={hidden ? false : LIST_POLL_MS} />}
            cards={<PhoneCardAnswering answering={session.cardAnswering} />}
          />
          <PhoneActivity
            entries={audit.data}
            now={now}
            wait={
              <QueryWait query={audit} what="remote activity">
                <Skeleton label="Loading remote activity" shape="list" rows={3} />
              </QueryWait>
            }
          />
        </div>
        <div className="ph-zone" role="group" aria-labelledby={outboundTitle}>
          <p id={outboundTitle} className="ph-zone-title">
            Control another {hostWords().computer}
          </p>
          <OtherSparks ownHostname={state.hostname} />
        </div>
      </div>
    </div>
  );
}
