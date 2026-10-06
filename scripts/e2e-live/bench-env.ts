import { join, resolve } from 'node:path';
import { createIntakeRecorder } from '../../apps/server/src/advisor/intake-recorder.ts';
import { memorySecretStore } from '../../apps/server/src/setup/secrets.ts';
import { createProviders } from '../../apps/server/src/workflow/providers.ts';
import { seedConnections } from '../../apps/server/test/orchestration-live-support.ts';
import { createTestDb } from '../../apps/server/test/support.ts';
import { startBench, type BenchEnv } from '../bench/live.ts';
import { STUB_URL } from './config.ts';
import type { Runtime } from './stack.ts';

const FAKE_AGENT = join(
  resolve(import.meta.dirname, '../..'),
  'apps/server/test/fake-acp-agent.ts',
);

export async function benchEnv(runtime: Runtime): Promise<BenchEnv> {
  if (runtime === 'acp') return startBench('acp');
  const t = await createTestDb();
  await seedConnections(t);
  const intake = createIntakeRecorder({
    db: t.db,
    secrets: memorySecretStore({ jev: 'e2e-dry-run-jev-key' }),
    fetch,
    baseUrl: `${STUB_URL}/typesafe`,
  });
  return {
    t,
    deps: {
      db: t.db,
      providers: createProviders('fake', FAKE_AGENT),
      leaseSeconds: 30,
      approvalPollMs: 200,
      intake,
    },
  };
}
