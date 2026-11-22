import { involvementLevelSchema, modePosture, type SparkOrigin } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { sparkCapability, type SparkJobKind } from './spark-capability.ts';
import type { SparkRunSettings } from './spark-settings.ts';

export interface SparkJobPlace {
  kind: SparkJobKind;
  origin: SparkOrigin;
  spark: { level: string | null };
  settings: Pick<SparkRunSettings, 'provider' | 'agentMode'>;
  reviewRun?: boolean;
  beforePublish?: boolean;
  testRun?: boolean;
}

async function isSubChat(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM sub_chats WHERE conversation_id = $1) AS found',
    [conversationId],
  );
  return rows[0]?.found === true;
}

export async function sparkWorkMark(
  db: Queryable,
  input: RunInput,
  job: SparkJobPlace,
): Promise<{ work?: true }> {
  const { capability } = sparkCapability({
    kind: job.kind,
    reviewRun: job.reviewRun === true,
    beforePublish: job.beforePublish === true,
    testRun: job.testRun === true,
    hasProject: input.projectRoots.length > 0 && !input.chatFolder,
    chatWorktree: input.chatWorktree === true,
    isSubChat: await isSubChat(db, input.identity.threadId),
    origin: job.origin,
    posture: modePosture(job.settings.provider, job.settings.agentMode),
    level: involvementLevelSchema.nullable().catch(null).parse(job.spark.level),
    confirmed: false,
  });
  return capability === 'work' ? { work: true } : {};
}
