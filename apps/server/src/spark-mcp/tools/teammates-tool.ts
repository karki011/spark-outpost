import { z } from 'zod';
import {
  TEAMMATE_STARTERS,
  TEAMMATE_STATE_LABELS,
  autonomyLabel,
  type TeammateView,
} from '@spark-outpost/contracts';
import { sparkJobCounts, type SparkJobCount } from '../../persistence/spark-mentions.ts';
import { teammateList } from '../../persistence/teammates.ts';
import { listProjects } from '../../projects/projects.ts';
import { nowOf } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export function matchTeammate<T extends { id: string; name: string }>(
  teammates: readonly T[],
  reference: string,
): T {
  const wanted = reference.trim().toLowerCase();
  const found = teammates.find(
    (teammate) => teammate.id === wanted || teammate.name.toLowerCase() === wanted,
  );
  if (found) return found;
  const names = teammates.map((teammate) => teammate.name).join(', ') || 'none';
  throw new SparkToolError(`No Spark called ${reference}. Sparks: ${names}.`);
}

function describe(
  teammate: TeammateView,
  projectNames: ReadonlyMap<string, string>,
  jobs: SparkJobCount | undefined,
) {
  return {
    id: teammate.id,
    name: teammate.name,
    role: teammate.role || null,
    face: `${teammate.face.shape} ${teammate.face.color}`,
    look: teammate.faceAuto ? 'from its name' : 'picked by the user',
    state: teammate.state,
    stateLabel: TEAMMATE_STATE_LABELS[teammate.state],
    homeChatId: teammate.homeConversationId,
    chats: teammate.chatCount,
    lastActivity: teammate.lastActivity,
    mentionJobs: jobs
      ? { total: jobs.jobs, lastChatId: jobs.lastChatId, lastAt: jobs.lastAt.toISOString() }
      : { total: 0 },
    defaults: {
      provider: teammate.provider ?? 'default provider',
      model: teammate.model ?? 'provider default',
      agentMode: teammate.agentMode ?? 'provider default',
      autonomy: teammate.level ? autonomyLabel(teammate.level) : 'Spark default',
      projects: teammate.projectIds.map((id) => projectNames.get(id) ?? id),
    },
    standingInstructions: teammate.instructions || null,
    instructionsFile: teammate.instructionsPath,
  };
}

async function sparks(context: SparkToolContext, args: { spark?: string | undefined }) {
  const { deps, scope } = context;
  const [list, projects, counts] = await Promise.all([
    teammateList(deps.db, scope.workspaceId, nowOf(deps)),
    listProjects(deps.db, scope.workspaceId),
    sparkJobCounts(deps.db, scope.workspaceId),
  ]);
  const jobs = new Map(counts.map((count) => [count.sparkId, count]));
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const shown = args.spark ? [matchTeammate(list.teammates, args.spark)] : list.teammates;
  return {
    sparks: shown.map((teammate) => describe(teammate, names, jobs.get(teammate.id))),
    ...(args.spark
      ? {}
      : {
          startersOffered: TEAMMATE_STARTERS.filter((starter) =>
            list.starters.includes(starter.id),
          ).map((starter) => `${starter.name} · ${starter.role}`),
        }),
    note: 'Sparks are named teammates. Each has a home chat and supplies defaults and standing instructions to chats started with it (Talk to…). In any other chat, @Name in a message hands that one job to the Spark as a read-only subagent with its own context; mentionJobs counts those and spark_chat shows each reply (sparkReplies). Change a Spark with spark_create_spark or spark_update_spark (confirm card).',
  };
}

export const teammatesTool = sparkTool({
  name: 'spark_sparks',
  title: 'Sparks (named teammates)',
  privateData: true,
  description:
    "List the user's Sparks: named teammates with a face, role, home chat and defaults (provider, model, mode, autonomy, projects) plus their standing instructions and, when the user pointed the Spark at one, the instructions file read at the start of each chat. Each has a state across its chats: idle, working, needs_you, done or failed, and the last chat it worked in, plus mentionJobs: how many one-off jobs an @mention handed it in other chats. Pass spark (name or id) for one.",
  input: {
    spark: z.string().trim().min(1).max(100).optional().describe('A Spark name or id.'),
  },
  run: (args, context) => sparks(context, args),
});
