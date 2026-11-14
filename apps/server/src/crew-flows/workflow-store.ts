import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import { crewWorkflowsDir } from '../crew/folders.ts';

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

export class WorkflowBusyError extends Error {
  constructor() {
    super('Another change to this workflow is being saved. Try again in a moment.');
  }
}

export class WorkflowProblemsError extends Error {
  readonly problems: readonly WorkflowProblem[];

  constructor(problems: readonly WorkflowProblem[]) {
    super(problems[0]?.text ?? 'This workflow has a problem.');
    this.problems = problems;
  }
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

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;

async function takeLock(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const held = await stat(lock).catch(() => null);
    if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
      await rm(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) throw new WorkflowBusyError();
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
}

async function withLock<T>(dir: string, id: string, work: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lock = join(dir, `.${id}.lock`);
  await takeLock(lock);
  try {
    return await work();
  } finally {
    await rm(lock, { recursive: true, force: true });
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

export function workflowStore(dir: string = crewWorkflowsDir()): WorkflowStore {
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
      return withLock(dir, workflow.id, async () => {
        const current = await readText(file);
        if (baseHash === null && current !== null) throw new WorkflowExistsError(workflow.id);
        if (baseHash !== null && (current === null || hashOf(current) !== baseHash)) {
          throw new WorkflowChangedError();
        }
        const text = `${JSON.stringify(workflow, null, 2)}\n`;
        const draft = join(dir, `.${workflow.id}.${randomUUID()}.tmp`);
        await writeFile(draft, text, { encoding: 'utf8', mode: 0o600 });
        await rename(draft, file);
        return { workflow, hash: hashOf(text) };
      });
    },
    async remove(id) {
      const file = fileOf(dir, id);
      await withLock(dir, id, async () => {
        if ((await readText(file)) === null) throw new WorkflowNotFoundError(id);
        await rm(file, { force: true });
      });
    },
  };
}
