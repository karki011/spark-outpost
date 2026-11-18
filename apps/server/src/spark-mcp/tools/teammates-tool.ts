import { z } from 'zod';
import { DRAFTS_NOTE, draftsView, pendingCrewCards } from '../../crew/crew-drafts.ts';
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
      effort: teammate.effort ?? 'provider default',
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
  const [list, projects, counts, cards] = await Promise.all([
    teammateList(deps.db, scope.workspaceId, nowOf(deps)),
    listProjects(deps.db, scope.workspaceId),
    sparkJobCounts(deps.db, scope.workspaceId),
    pendingCrewCards(deps.db, scope.workspaceId),
  ]);
  const drafts = draftsView(cards, scope.conversationId);
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
          ...(drafts.length > 0 ? { drafts, draftsNote: DRAFTS_NOTE } : {}),
        }),
    note: 'Sparks are named teammates. Each has a home chat and supplies defaults and standing instructions to chats started with it (Talk to…). In any other chat, @Name in a message hands that one job to the Spark as a read-only subagent with its own context; mentionJobs counts those and spark_chat shows each reply (sparkReplies). Add, change or delete a Spark with spark_create_spark or spark_update_spark, and its files, skills and workflows with spark_crew_edit. Each follows your mode: done at once, or a card for the user (always a card after this turn read web pages, tickets or other untrusted data). Names are unique.',
  };
}

export const teammatesTool = sparkTool({
  name: 'spark_sparks',
  title: 'Sparks (named teammates)',
  privateData: true,
  description:
    "List the user's Sparks (named teammates): state across chats, home chat, defaults, instructions, @mention job counts, drafts. Pass spark (name or id) for one. Files and skills: spark_crew.",
  input: {
    spark: z.string().trim().min(1).max(100).optional(),
  },
  run: (args, context) => sparks(context, args),
});
