import type { SparkScope } from '../../spark-mcp/deps.ts';
import { sparkGrantKey, type SparkGrant } from '../../spark-mcp/host.ts';
import type { SparkToolsHint } from './spark-instructions.ts';
import type { SparkTools, SparkToolsAccess } from './spark-tools.ts';

export interface LiveTools {
  hint: SparkToolsHint;
  key: string;
  grant: SparkGrant;
}

type Rebinding = SparkToolsAccess & Required<Pick<SparkToolsAccess, 'rebind'>>;

export function rebinds(access: SparkToolsAccess | undefined): access is Rebinding {
  return access?.rebind !== undefined;
}

export function liveTools(tools: SparkTools): LiveTools {
  const { grant, ...hint } = tools;
  return { hint, key: sparkGrantKey(grant.token), grant };
}

export async function regrant(
  access: Rebinding,
  live: LiveTools,
  scope: SparkScope,
): Promise<SparkTools> {
  live.grant = await access.rebind(scope, live.key);
  return { ...live.hint, grant: live.grant };
}

export function betweenTurns(scope: SparkScope, waitForRun: () => Promise<void>): SparkScope {
  return {
    workspaceId: scope.workspaceId,
    conversationId: scope.conversationId,
    runId: null,
    readOnly: true,
    rebinds: true,
    beforeToolCall: waitForRun,
  };
}
