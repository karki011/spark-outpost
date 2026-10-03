import { z } from 'zod';
import { createCodeScanner } from '../../codescan/scanner.ts';
import { codeLeads, leadLabel, type CodeLeads } from '../../find/leads.ts';
import { findIssues, findStatus } from '../../find/status.ts';
import { readIgnore } from '../../projects/project-fs.ts';
import { sparkTool, type SparkToolContext } from '../tool.ts';
import { findProject } from './project-tools.ts';

const NO_LEADS: CodeLeads = { leads: [], withoutRanges: 0, onMap: false };

const underInput = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'under must be a folder inside the project, like apps/server/src.',
  })
  .transform((value) => value.replace(/^\.\//, '').replace(/\/+$/, ''))
  .optional()
  .describe('Only files under this folder, relative to the project folder.');

async function find(
  context: SparkToolContext,
  args: { query: string; project?: string | undefined; under?: string | undefined; limit: number },
) {
  const project = await findProject(context, args.project);
  const { db } = context.deps;
  const scanner = context.deps.codeScan ?? createCodeScanner(db);
  const outcome = await scanner.scan(project.rootPath, args.query);
  const found = outcome.report
    ? await codeLeads(db, project.rootPath, outcome.report, {
        ignore: await readIgnore(project.rootPath),
        limit: args.limit,
        under: args.under,
      })
    : NO_LEADS;
  return {
    project: project.name,
    status: findStatus(outcome, found),
    issues: findIssues(outcome, found),
    indexedFiles: outcome.report?.indexedFiles ?? 0,
    files: found.leads.map((lead) => ({
      path: lead.path,
      score: lead.score,
      reasons: lead.reasons,
      area: lead.area,
      kind: lead.kind,
      declarations: lead.declarations.map(leadLabel),
    })),
  };
}

export const findTool = sparkTool({
  name: 'spark_find',
  title: 'Find code',
  description:
    "Finds where something lives in a project's code: files ranked for a request or a symbol, each with a score, why it matched, its Map area and its top declarations as name@startLine-endLine, so you can read just those lines. Returns no file contents and never lists secret files. status is complete, partial (out of time, or line ranges missing) or index_building, with issues saying what is missing. A ranking hint, not a limit. Defaults to this chat's project.",
  input: {
    query: z
      .string()
      .trim()
      .min(2)
      .max(2000)
      .describe('What to find: a request in plain words, a symbol, a file name or a path.'),
    project: z.string().max(200).optional().describe('Project name or id.'),
    under: underInput,
    limit: z.number().int().min(1).max(40).default(12).describe('How many files (1-40).'),
  },
  run: (args, context) => find(context, args),
});
