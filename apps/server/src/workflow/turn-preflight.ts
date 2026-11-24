import { repoScanner } from '../agent-config/discovery.ts';
import { loadRepoLaunch } from '../agent-config/launch.ts';
import type { Db } from '../persistence/db.ts';
import type { RunSnapshot } from '../persistence/run-snapshots.ts';
import type { SparkPreferences } from '../persistence/setup.ts';
import { doRunSnapshot } from './do-run.ts';
import { startRailFlags, type RailFlagRecorder, type RailFlagsOptions } from './rail-flags.ts';
import type { RunInput } from './run-input.ts';
import { knownModes } from './run-metadata.ts';
import { together } from './together.ts';
import { loadTurnExtensions } from './turn-extensions.ts';
import { sparkSession } from './turn-facts.ts';

export function startTurnReads(db: Db, input: RunInput, prefs: SparkPreferences | undefined) {
  return Promise.allSettled([
    loadRepoLaunch(db, repoScanner, input.identity.threadId, input.projectRoots).catch(() => []),
    knownModes(db, input),
    loadTurnExtensions(db, input),
    sparkSession(db, input, prefs),
  ] as const);
}

type Baseline = [RunSnapshot | undefined, RailFlagRecorder | null];

export async function doBaseline(
  turn: RailFlagsOptions & Pick<RunInput, 'mode' | 'chatFolder'>,
  kept: RunSnapshot | undefined,
): Promise<Baseline> {
  if (turn.mode !== 'do') return [undefined, null];
  const { db, runId, projectRoots } = turn;
  return together([
    doRunSnapshot({ db, runId, projectRoots, keepsCopies: !turn.chatFolder, snapshot: kept }),
    startRailFlags(turn),
  ]);
}
