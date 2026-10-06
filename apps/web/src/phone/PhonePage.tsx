import './phone.css';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteSession } from '@spark-outpost/contracts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { PairPhone } from './PairPhone.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { PhoneActivity } from './PhoneActivity.tsx';
import { PhoneDevices } from './PhoneDevices.tsx';
import { PhoneStatus } from './PhoneStatus.tsx';
import { PhoneSwitches, PhoneSwitchesReadOnly } from './PhoneSwitches.tsx';

const STATE_POLL_MS = 10_000;
const LIST_POLL_MS = 5000;
const FRESH_MS = 9000;

function MacPhonePage({ session }: { session: RemoteSession }) {
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

  useEffect(() => {
    if (freshAfter === null) return;
    const timer = setTimeout(() => setFreshAfter(null), FRESH_MS);
    return () => clearTimeout(timer);
  }, [freshAfter]);

  if (!tailscale.data) {
    return (
      <QueryWait query={tailscale} what="phone access">
        <Skeleton label="Loading phone access" shape="cards" rows={3} />
      </QueryWait>
    );
  }
  const list = devices.data ?? [];
  return (
    <>
      <PhoneStatus
        state={tailscale.data}
        wanted={session.address !== null}
        connected={list.some((device) => device.connected && !device.revokedAt)}
        checking={tailscale.isFetching}
        onCheck={() => void tailscale.refetch()}
      />
      <PairPhone
        tailscale={tailscale.data}
        onPaired={() => {
          setFreshAfter(Date.now());
          void queryClient.invalidateQueries({ queryKey: phoneKeys.devices });
        }}
      />
      <PhoneDevices
        devices={devices.data}
        freshAfter={freshAfter}
        wait={
          <QueryWait query={devices} what="devices">
            <Skeleton label="Loading devices" shape="list" rows={2} />
          </QueryWait>
        }
      />
      <PhoneSwitches switches={session.switches} />
      <PhoneActivity
        entries={audit.data}
        wait={
          <QueryWait query={audit} what="phone activity">
            <Skeleton label="Loading phone activity" shape="list" rows={3} />
          </QueryWait>
        }
      />
    </>
  );
}

function RemotePhonePage({ session }: { session: RemoteSession }) {
  return (
    <>
      <section className="ph-card" aria-labelledby="ph-status-title">
        <h2 id="ph-status-title" data-status="on">
          <i className="ph-dot" aria-hidden="true" />
          Connected to your Mac
        </h2>
        {session.address && (
          <div className="ph-address">
            <span className="ph-address-label">Address</span>
            <code>{session.address}</code>
          </div>
        )}
      </section>
      <section className="ph-card" aria-labelledby="ph-device-title">
        <h2 id="ph-device-title">This device</h2>
        <p className="ph-note">
          {session.device ? <b>{session.device.name}</b> : 'This phone'} is paired. To rename or
          remove it, open Phone on your Mac.
        </p>
      </section>
      <PhoneSwitchesReadOnly switches={session.switches} />
    </>
  );
}

export function PhonePage() {
  const session = useQuery({ queryKey: phoneKeys.session, queryFn: phoneApi.session });
  return (
    <main className="page ph" aria-labelledby="ph-title">
      <div className="ph-scroll">
        <div className="ph-wrap">
          <header className="ph-head">
            <h1 id="ph-title">Phone</h1>
            <p>
              Use Spark Outpost from your phone while the work stays on{' '}
              {session.data?.remote ? 'your' : 'this'} Mac.
            </p>
          </header>
          <QueryWait query={session} what="phone settings">
            <Skeleton label="Loading phone settings" shape="cards" rows={3} />
          </QueryWait>
          {session.data &&
            (session.data.remote ? (
              <RemotePhonePage session={session.data} />
            ) : (
              <MacPhonePage session={session.data} />
            ))}
        </div>
      </div>
    </main>
  );
}
