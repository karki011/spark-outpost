import { nextCrewName } from '@spark-outpost/contracts';
import { usedNames } from '../persistence/orchestrations.ts';
import type { Seat, Session } from '../orchestration/session.ts';
import { builderEnvFor } from './builder-env.ts';
import type { Coordination } from './state.ts';

export async function integratorSeat(s: Session, coordination: Coordination): Promise<Seat> {
  const used = await usedNames(s.deps.db, s.taskId!, 'integrator');
  const name = used[0] ?? nextCrewName('integrator', used);
  return {
    role: 'integrator',
    name,
    resumeKey: `${s.taskId}:integrator`,
    prompt: null,
    route: {
      guard: { coordinated: true, owned: null },
      builderEnv: builderEnvFor(coordination.builderEnv, 1, name),
    },
  };
}
