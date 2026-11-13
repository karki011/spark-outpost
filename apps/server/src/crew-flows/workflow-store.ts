import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  CREW_SLUG_PATTERN,
  workflowProblems,
  workflowSchema,
  workflowStages,
  type Workflow,
  type WorkflowFile,
  type WorkflowProblem,
  type WorkflowSummary,
} from '@spark-outpost/contracts';
import { sparkDataDir } from '../config.ts';
import { sparkChannel } from '../spark-rules/rules-store.ts';

export const WORKFLOWS_FOLDER = 'workflows';

export class WorkflowNotFoundError extends Error {
  constructor(id: string) {
    super(`There is no workflow called ${id}.`);
  }
}

export class WorkflowChangedError extends Error {
  constructor() {
    super('This workflow changed since you opened it. Reload it and make the change again.');
  }
}

export class WorkflowExistsError extends Error {
  constructor(id: string) {
    super(`A workflow called ${id} already exists.`);
  }
}

export class WorkflowProblemsError extends Error {
  readonly problems: readonly WorkflowProblem[];

  constructor(problems: readonly WorkflowProblem[]) {
    super(problems[0]?.text ?? 'This workflow has a problem.');
    this.problems = problems;
  }
}

export function workflowsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SPARK_WORKFLOWS_DIR?.trim();
  if (override && isAbsolute(override)) return override;
  return join(
    sparkDataDir({ SPARK_DATA_DIR: env.SPARK_DATA_DIR }),
    sparkChannel(env),
    WORKFLOWS_FOLDER,
  );
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function fileOf(dir: string, id: string): string {
  if (!CREW_SLUG_PATTERN.test(id)) throw new WorkflowNotFoundError(id);
  return join(dir, `${id}.json`);
}

function parseWorkflow(id: string, text: string): Workflow | null {
  try {
    const parsed = workflowSchema.safeParse(JSON.parse(text));
    return parsed.success && parsed.data.id === id ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export interface WorkflowStore {
  list(sparkIds: ReadonlySet<string>): Promise<WorkflowSummary[]>;
  ids(): Promise<string[]>;
  read(id: string): Promise<WorkflowFile | null>;
  save(
    workflow: Workflow,
    baseHash: string | null,
    sparkIds: ReadonlySet<string>,
  ): Promise<WorkflowFile>;
  remove(id: string): Promise<void>;
}

export function workflowStore(dir: string = workflowsDir()): WorkflowStore {
  const ids = async (): Promise<string[]> => {
    const names = await readdir(dir).catch((error: unknown) => {
      if (isMissing(error)) return [] as string[];
      throw error;
    });
    return names
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((id) => CREW_SLUG_PATTERN.test(id))
      .sort();
  };

  const read = async (id: string): Promise<WorkflowFile | null> => {
    const text = await readText(fileOf(dir, id));
    if (text === null) return null;
    const workflow = parseWorkflow(id, text);
    return workflow ? { workflow, hash: hashOf(text) } : null;
  };

  return {
    ids,
    read,
    async list(sparkIds) {
      const files = await Promise.all((await ids()).map((id) => read(id)));
      return files.flatMap((file): WorkflowSummary[] => {
        if (!file) return [];
        const { id, name, steps } = file.workflow;
        const sparkOf = new Map(steps.map((step) => [step.id, step.sparkId]));
        return [
          {
            id,
            name,
            stages: workflowStages(steps).map((stage) =>
              stage.map((stepId) => ({ stepId, sparkId: sparkOf.get(stepId)! })),
            ),
            problems: workflowProblems(steps, sparkIds).length,
          },
        ];
      });
    },
    async save(workflow, baseHash, sparkIds) {
      const problems = workflowProblems(workflow.steps, sparkIds);
      if (problems.length > 0) throw new WorkflowProblemsError(problems);
      const file = fileOf(dir, workflow.id);
      const current = await readText(file);
      if (baseHash === null && current !== null) throw new WorkflowExistsError(workflow.id);
      if (baseHash !== null && (current === null || hashOf(current) !== baseHash)) {
        throw new WorkflowChangedError();
      }
      const text = `${JSON.stringify(workflow, null, 2)}\n`;
      await mkdir(dir, { recursive: true });
      const draft = join(dir, `.${workflow.id}.${randomUUID()}.tmp`);
      await writeFile(draft, text, { encoding: 'utf8', mode: 0o600 });
      await rename(draft, file);
      return { workflow, hash: hashOf(text) };
    },
    async remove(id) {
      const file = fileOf(dir, id);
      if ((await readText(file)) === null) throw new WorkflowNotFoundError(id);
      await rm(file, { force: true });
    },
  };
}
