import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteReach, RemoteSession, TailscaleState } from '@spark-outpost/contracts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { REPLACES_CUSTOM } from './custom-domain.ts';
import { CustomDomainSetup } from './CustomDomainSetup.tsx';
import { activationOf, turnFailure } from './pair-flow.ts';
import { PairPhone } from './PairPhone.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { PhoneActivity } from './PhoneActivity.tsx';
import { PhoneDevices } from './PhoneDevices.tsx';
import { DisconnectAll, PhoneRail } from './PhoneRail.tsx';
import { PhoneStatus } from './PhoneStatus.tsx';
import { ReachChoice } from './ReachChoice.tsx';
import { PhoneSwitches } from './PhoneSwitches.tsx';
import { PhoneCardAnswering } from './PhoneCardAnswering.tsx';
import { PushContact } from './PushContact.tsx';
import { RemoteTabs } from './RemoteTabs.tsx';
import { setupSteps } from './setup-steps.ts';
import { OtherSparks } from '../remote-sparks/OtherSparks.tsx';
import { cloudflareApi, cloudflareKeys } from '../cloudflare/cloudflare-api.ts';
import { CloudflareTunnelLine } from '../cloudflare/CloudflareTunnelLine.tsx';

const STATE_POLL_MS = 10_000;
const LIST_POLL_MS = 5000;
const FRESH_MS = 9000;

function customDomainState(hostname: string): TailscaleState {
  return { status: 'on', hostname, address: `https://${hostname}`, message: null };
}

export function MacPhonePage({ session }: { session: RemoteSession }) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const now = useMinuteClock();
  const [freshAfter, setFreshAfter] = useState<number | null>(null);
  const [picked, setPicked] = useState<RemoteReach | null>(null);
  const tailscale = useQuery({
    queryKey: phoneKeys.tailscale,
    queryFn: phoneApi.tailscale,
    refetchInterval: hidden ? false : STATE_POLL_MS,
  });
  const access = useQuery({ queryKey: phoneKeys.access, queryFn: phoneApi.access });
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
  const turnOffCustom = useMutation({
    mutationFn: async () => {
      const next = await phoneApi.setAccess({ hostname: null });
      await cloudflareApi.removeReach().catch(() => undefined);
      return next;
    },
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: cloudflareKeys.reach });
      setPicked('custom');
      queryClient.setQueryData(phoneKeys.access, next);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.all });
    },
  });
  const failure = turnFailure(turn.error, turn.data);

  useEffect(() => {
    if (freshAfter === null) return;
    const timer = setTimeout(() => setFreshAfter(null), FRESH_MS);
    return () => clearTimeout(timer);
  }, [freshAfter]);

  if (!tailscale.data || !access.data) {
    return (
      <QueryWait query={tailscale.data ? access : tailscale} what="remote control">
        <Skeleton label="Loading remote control" shape="cards" rows={3} />
      </QueryWait>
    );
  }
  const customHost = access.data.reach === 'custom' ? access.data.hostname : null;
  const reach = picked ?? (customHost === null ? 'tailscale' : 'custom');
  const live = tailscale.data;
  const state = customHost === null ? live : customDomainState(customHost);
  const shown = reach === 'custom' ? state : live;
  const setup = reach === 'custom' ? customHost === null : setupSteps(live.status) !== null;
  const wanted = customHost === null && session.address !== null;
  const choice = <ReachChoice reach={reach} onChange={setPicked} />;
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
    <RemoteTabs
      setup={setup}
      panels={{
        setup: (
          <>
            {setup ? (
              <div className="ph-area ph-area-setup">
                {reach === 'custom' ? (
                  <CustomDomainSetup
                    choice={choice}
                    forwardTo={access.data.forwardTo}
                    replacesTailscale={live.status === 'on'}
                    onSaved={(next) => {
                      setPicked(null);
                      queryClient.setQueryData(phoneKeys.access, next);
                      void queryClient.invalidateQueries({ queryKey: phoneKeys.all });
                    }}
                  />
                ) : (
                  <PhoneStatus
                    state={live}
                    checking={tailscale.isFetching}
                    turning={turn.isPending}
                    on={live.status === 'on' || (live.status === 'error' && wanted)}
                    failure={failure}
                    choice={choice}
                    notice={customHost === null ? null : REPLACES_CUSTOM}
                    onCheck={() => void tailscale.refetch()}
                    onTurn={(to) => turn.mutate(to)}
                  />
                )}
              </div>
            ) : reach === 'custom' ? (
              <PhoneRail
                state={shown}
                wanted={false}
                devices={devices.data}
                switches={session.switches}
                lastRequest={audit.data?.[0]?.at ?? null}
                turning={turnOffCustom.isPending}
                failure={turnOffCustom.error?.message ?? null}
                choice={
                  <>
                    {choice}
                    {customHost && <CloudflareTunnelLine hostname={customHost} />}
                  </>
                }
                custom
                onTurn={() => turnOffCustom.mutate()}
              />
            ) : (
              <PhoneRail
                state={shown}
                wanted={wanted}
                devices={devices.data}
                switches={session.switches}
                lastRequest={audit.data?.[0]?.at ?? null}
                turning={turn.isPending}
                failure={failure}
                choice={choice}
                onTurn={(to) => turn.mutate(to)}
              />
            )}
          </>
        ),
        devices: (
          <>
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
            {(devices.data ?? []).some((device) => !device.revokedAt) && <DisconnectAll />}
            <PhoneActivity
              entries={audit.data}
              now={now}
              wait={
                <QueryWait query={audit} what="remote activity">
                  <Skeleton label="Loading remote activity" shape="list" rows={3} />
                </QueryWait>
              }
            />
          </>
        ),
        permissions: (
          <>
            <PhoneSwitches
              switches={session.switches}
              notificationsExtra={<PushContact poll={hidden ? false : LIST_POLL_MS} />}
              cards={<PhoneCardAnswering answering={session.cardAnswering} />}
            />
          </>
        ),
        others: (
          <>
            <OtherSparks ownHostname={state.hostname} />
          </>
        ),
      }}
    />
  );
}
