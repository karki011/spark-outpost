import os from 'node:os';
import type { AgentModeOption } from '@spark-outpost/contracts';
import type { RunObservations } from '../observations/run-observations.ts';
import type { Queryable } from '../persistence/db.ts';
import { projectPolicy } from '../projects/project-fs.ts';
import type { SparkCommandScope } from './command-gate.ts';
import { publishGrant } from './publish-context.ts';
import type { RunInput } from './run-input.ts';

type ScopeInput = Pick<
  RunInput,
  | 'provider'
  | 'agentMode'
  | 'mode'
  | 'assistant'
  | 'projectRoots'
  | 'level'
  | 'userRequest'
  | 'followUpRound'
  | 'workspaceId'
  | 'outpostRequest'
  | 'identity'
>;

export interface ScopeExtras {
  modes?: readonly AgentModeOption[];
  observations?: RunObservations | undefined;
}

export async function sparkCommandScope(
  db: Queryable,
  runId: string,
  input: ScopeInput,
  extras: ScopeExtras = {},
): Promise<SparkCommandScope> {
  const roots = await projectPolicy(input.projectRoots).then(
    (policy) => policy.roots,
    () => [],
  );
  return {
    db,
    runId,
    provider: input.provider,
    agentMode: input.agentMode,
    ...(extras.modes ? { modes: extras.modes } : {}),
    runMode: input.mode,
    readOnly: input.assistant === true,
    roots,
    home: os.homedir(),
    publish: publishGrant(input),
    observations: extras.observations,
  };
}
