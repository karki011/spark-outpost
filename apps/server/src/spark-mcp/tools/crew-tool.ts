import { z } from 'zod';
import { SPARK_INSTRUCTIONS_FILE, type Teammate } from '@spark-outpost/contracts';
import { workflowStore } from '../../crew-flows/workflow-store.ts';
import { crewSparks, sparkLine, workflowLines } from '../../crew/crew-view.ts';
import { crewSparksDir } from '../../crew/folders.ts';
import {
  CrewFileNotFoundError,
  CrewFileProblemError,
  readCrewFile,
} from '../../crew/spark-folder.ts';
import { sparkFolder } from '../../crew/spark-skills.ts';
import { CREW_READ_REFUSALS, crewReadRefusal } from '../../crew/tool-offer.ts';
import { listTeammates } from '../../persistence/teammates.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { matchTeammate } from './teammates-tool.ts';

export const CREW_TOOL = 'spark_crew';

interface ReadAudit {
  target: 'spark' | 'workflow';
  id: string;
  path: string;
  bytes: number;
}

function auditRead(context: SparkToolContext, read: ReadAudit): void {
  context.scope.actions?.audit?.message('harness', {
    method: 'spark/crew_read',
    params: { tool: CREW_TOOL, runId: context.scope.runId, ...read },
  });
}

async function readFile(context: SparkToolContext, teammate: Teammate, path: string) {
  try {
    const file = await readCrewFile(crewSparksDir(), teammate.id, path);
    auditRead(context, {
      target: 'spark',
      id: teammate.id,
      path,
      bytes: Buffer.byteLength(file.text, 'utf8'),
    });
    return { spark: teammate.name, ...file };
  } catch (error) {
    if (error instanceof CrewFileNotFoundError) {
      throw new SparkToolError(`${teammate.name} has no file ${path}.`);
    }
    if (error instanceof CrewFileProblemError) throw new SparkToolError(error.message);
    throw error;
  }
}

async function readFolder(teammate: Teammate) {
  const folder = await sparkFolder(crewSparksDir(), teammate.id);
  return {
    spark: teammate.name,
    id: teammate.id,
    files: folder.files,
    skills: folder.skills,
    ...(folder.problems.length > 0 ? { problems: folder.problems } : {}),
    ...(teammate.instructionsPath ? { instructionsFile: teammate.instructionsPath } : {}),
    note: `${SPARK_INSTRUCTIONS_FILE} holds the instructions. Pass path for a file’s text.`,
  };
}

async function readWorkflow(context: SparkToolContext, id: string, teammates: readonly Teammate[]) {
  const file = await workflowStore()
    .read(id)
    .catch(() => null);
  if (!file) throw new SparkToolError(`There is no workflow called ${id}.`);
  auditRead(context, {
    target: 'workflow',
    id,
    path: `${id}.json`,
    bytes: Buffer.byteLength(JSON.stringify(file.workflow), 'utf8'),
  });
  const names = new Map(teammates.map((teammate) => [teammate.id, teammate.name]));
  return {
    workflow: {
      ...file.workflow,
      steps: file.workflow.steps.map((step) => ({
        ...step,
        spark: names.get(step.sparkId) ?? null,
      })),
    },
    hash: file.hash,
  };
}

interface CrewArgs {
  spark?: string | undefined;
  path?: string | undefined;
  workflow?: string | undefined;
}

async function crew(args: CrewArgs, context: SparkToolContext) {
  const { deps, scope } = context;
  const refused = await crewReadRefusal(deps.db, scope);
  if (refused) throw new SparkToolError(CREW_READ_REFUSALS[refused]);
  const teammates = await listTeammates(deps.db, scope.workspaceId);
  if (args.workflow) return readWorkflow(context, args.workflow, teammates);
  if (args.spark) {
    const teammate = matchTeammate(teammates, args.spark);
    return args.path ? readFile(context, teammate, args.path) : readFolder(teammate);
  }
  const sparks = await crewSparks(crewSparksDir(), teammates);
  return {
    sparks: sparks.map(sparkLine),
    workflows: await workflowLines(workflowStore(), teammates),
  };
}

export const crewTool = sparkTool({
  name: CREW_TOOL,
  needs: 'crew_read',
  title: 'Sparks, skills and workflows',
  description:
    'The user’s crew. No arguments: every Spark (role, agent, mode, skills) and workflow (stages). spark (name or id): its files; with path: one file’s text. workflow (id): that workflow. Check before proposing a Spark or skill.',
  input: {
    spark: z.string().optional(),
    path: z.string().optional(),
    workflow: z.string().optional(),
  },
  run: (args, context) => crew(args, context),
});
