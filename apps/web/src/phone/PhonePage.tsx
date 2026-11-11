import './phone.css';
import './phone-setup.css';
import './phone-devices.css';
import './phone-switches.css';
import { useQuery } from '@tanstack/react-query';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { MacPhonePage } from './MacPhonePage.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { RemotePhonePage } from './RemotePhonePage.tsx';

export function PhonePage() {
  const session = useQuery({ queryKey: phoneKeys.session, queryFn: phoneApi.session });
  return (
    <main className="page ph" aria-labelledby="ph-title">
      <div className="ph-scroll">
        <div className="ph-wrap">
          <header className="ph-head">
            <h1 id="ph-title">Remote control</h1>
            <p>
              Use Spark Outpost from another device while the work stays on{' '}
              {session.data?.remote ? 'your' : 'this'} Mac.
            </p>
          </header>
          <QueryWait query={session} what="remote control">
            <Skeleton label="Loading remote control" shape="cards" rows={3} />
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
