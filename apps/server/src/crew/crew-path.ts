import type { SparkActionName } from '@spark-outpost/contracts';
import type { RunObservations } from '../observations/run-observations.ts';
import type { Queryable } from '../persistence/db.ts';
import {
  actionFacts,
  actionPath,
  userWroteTurn,
  type ActionPath,
} from '../spark-mcp/actions/action-policy.ts';

const CREW_READ_TOOLS = ['spark_sparks', 'spark_crew', 'spark_docs'];
const CREW_READS = new Set(CREW_READ_TOOLS.map((tool) => `private work data (${tool})`));

export function untrustedReads(labels: readonly string[]): string[] {
  return labels.filter((label) => !CREW_READS.has(label));
}

export interface CrewPathFacts {
  modePath: ActionPath;
  fullAccess: boolean;
  userWrote: boolean;
  untrusted: readonly string[] | null;
}

export function crewPath(facts: CrewPathFacts): ActionPath {
  if (facts.fullAccess) return 'perform';
  if (facts.untrusted === null || facts.untrusted.length > 0) return 'confirm';
  if (!facts.userWrote) return 'confirm';
  return facts.modePath;
}

export interface CrewDecision {
  path: ActionPath;
  observed: string[];
}

export async function crewDecision(
  db: Queryable,
  runId: string,
  observations: RunObservations | undefined,
  action: SparkActionName,
): Promise<CrewDecision> {
  const [facts, userWrote] = await Promise.all([
    actionFacts(db, runId, action),
    userWroteTurn(db, runId),
  ]);
  const labels = observations ? await observations.completeLabels() : null;
  const untrusted = labels === null ? null : untrustedReads(labels);
  return {
    path: crewPath({
      modePath: actionPath(facts),
      fullAccess: facts.posture === 'full_access',
      userWrote,
      untrusted,
    }),
    observed: untrusted ?? [],
  };
}
