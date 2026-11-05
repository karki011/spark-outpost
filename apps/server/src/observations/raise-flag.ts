import type { Queryable } from '../persistence/db.ts';
import { flagAgentName, insertRailFlag, type NewRailFlag } from '../persistence/rail-flags.ts';
import type { ProtocolObserver } from '../providers/provider.ts';

function auditStopped(audit: ProtocolObserver | undefined, flag: NewRailFlag) {
  try {
    audit?.message('harness', {
      method: 'spark/rail_stopped',
      params: { toolCallId: flag.toolCallId, rail: flag.rail, paths: flag.paths },
    });
  } catch (error) {
    console.error('Could not audit a stopped rail crossing', error);
  }
}

export async function raiseRailFlag(
  db: Queryable,
  runId: string,
  audit: ProtocolObserver | undefined,
  flag: NewRailFlag,
): Promise<void> {
  if (flag.stopped) {
    auditStopped(audit, flag);
    return;
  }
  const agent = await flagAgentName(db, runId);
  const saved = await insertRailFlag(db, runId, agent, flag);
  if (!saved) return;
  try {
    audit?.message('harness', {
      method: 'spark/rail_crossed',
      params: { flagId: saved.id, rail: saved.rail, title: saved.title, paths: saved.paths },
    });
  } catch (error) {
    console.error('Could not audit a rail flag', error);
  }
}
