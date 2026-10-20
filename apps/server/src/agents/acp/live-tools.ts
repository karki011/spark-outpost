import type { SparkScope } from '../../spark-mcp/deps.ts';
import { sparkGrantKey, type SparkGrant } from '../../spark-mcp/host.ts';
import type { SparkToolsHint } from './spark-instructions.ts';
import type { SparkTools, SparkToolsAccess } from './spark-tools.ts';

export interface LiveTools {
  hint: SparkToolsHint;
  key: string;
  grant: SparkGrant;
}

type Restoring = SparkToolsAccess & Required<Pick<SparkToolsAccess, 'restore'>>;

export function restores(access: SparkToolsAccess | undefined): access is Restoring {
  return access?.restore !== undefined;
}

export function liveTools(tools: SparkTools): LiveTools {
  const { grant, ...hint } = tools;
  return { hint, key: sparkGrantKey(grant.token), grant };
}

export async function regrant(
  access: Restoring,
  live: LiveTools,
  scope: SparkScope,
): Promise<SparkTools> {
  live.grant.revoke();
  live.grant = await access.restore(scope, live.key);
  return { ...live.hint, grant: live.grant };
}

export function betweenTurns(
  scope: SparkScope,
  waitForRun: () => Promise<void>,
): SparkScope {
  return {
    workspaceId: scope.workspaceId,
    conversationId: scope.conversationId,
    runId: null,
    readOnly: true,
    rebinds: true,
    beforeToolCall: waitForRun,
  };
}
