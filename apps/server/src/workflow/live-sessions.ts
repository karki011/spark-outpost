import { closedChats, startAgentCycleRun } from '../persistence/agent-cycle-runs.ts';
import type { Db } from '../persistence/db.ts';
import type { LiveSessions, Provider } from '../providers/provider.ts';
import type { ResolveTarget } from './queue-drain.ts';

export interface LiveSessionWatch {
  sweep(): Promise<void>;
  workdirs(): string[];
  closeAll(): Promise<void>;
}

function withSessions(providers: ReadonlyMap<string, Provider>): [string, LiveSessions][] {
  return [...providers].flatMap(([name, provider]) =>
    provider.sessions ? [[name, provider.sessions] as [string, LiveSessions]] : [],
  );
}

export function watchLiveSessions(
  db: Db,
  providers: ReadonlyMap<string, Provider>,
  resolveTarget: ResolveTarget,
  wake: () => void,
): LiveSessionWatch {
  const watched = withSessions(providers);
  const startCycle = async (provider: string, conversationId: string) => {
    const target = await resolveTarget(conversationId);
    if (target.provider !== provider) return;
    if (await startAgentCycleRun(db, conversationId, target)) wake();
  };
  const tryCycle = (provider: string, conversationId: string) =>
    startCycle(provider, conversationId).catch((error: unknown) =>
      console.error(`Could not start the agent's own turn in chat ${conversationId}`, error),
    );
  for (const [provider, sessions] of watched) {
    sessions.onCycle((conversationId) => void tryCycle(provider, conversationId));
  }
  return {
    async sweep() {
      for (const [provider, sessions] of watched) {
        for (const conversationId of await closedChats(db, sessions.conversations())) {
          await sessions.close(conversationId);
        }
        for (const conversationId of sessions.waiting()) await tryCycle(provider, conversationId);
      }
    },
    workdirs: () => watched.flatMap(([, sessions]) => sessions.workdirs()),
    async closeAll() {
      await Promise.all(watched.map(([, sessions]) => sessions.closeAll()));
    },
  };
}
