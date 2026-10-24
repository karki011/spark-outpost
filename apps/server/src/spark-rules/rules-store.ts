import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { sparkDataDir } from '../config.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { RECOMMENDED_RULES } from './recommended.ts';
import type { SparkRuleSet } from './resolve.ts';
import {
  changedRulesText,
  NO_RULE_LISTS,
  parseRulesFile,
  RulesFileError,
  type RuleChange,
  type RuleLists,
} from './rules-file.ts';

export interface SparkRulesFiles {
  user: string;
  managed: string;
}

export interface RuleProblem {
  file: 'managed' | 'user';
  message: string;
}

export interface LoadedRules {
  rules: SparkRuleSet;
  problems: RuleProblem[];
  userFile: RulesFileRead;
  userFailedSafe: boolean;
}

export const MANAGED_RULES_FILE = '/Library/Application Support/SparkOutpost/managed-settings.json';
export const USER_RULES_NAME = 'settings.json';
const MAX_FILE_BYTES = 256 * 1024;

function absolute(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && isAbsolute(trimmed) ? trimmed : null;
}

export function sparkChannel(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRANCH_PREFIX?.trim() || DEFAULT_BRANCH_PREFIX;
}

export function sparkRulesFiles(env: NodeJS.ProcessEnv = process.env): SparkRulesFiles {
  const dataDir = () => sparkDataDir({ SPARK_DATA_DIR: env.SPARK_DATA_DIR });
  return {
    user: absolute(env.SPARK_RULES_FILE) ?? join(dataDir(), sparkChannel(env), USER_RULES_NAME),
    managed: absolute(env.SPARK_MANAGED_RULES_FILE) ?? MANAGED_RULES_FILE,
  };
}

export type RulesFileRead =
  { kind: 'missing' } | { kind: 'text'; text: string } | { kind: 'unreadable' };

const ABSENT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

function absentError(error: unknown): boolean {
  return ABSENT_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '');
}

async function readRulesFile(file: string): Promise<RulesFileRead> {
  let found;
  try {
    found = await stat(file);
  } catch (error) {
    return absentError(error) ? { kind: 'missing' } : { kind: 'unreadable' };
  }
  if (!found.isFile() || found.size > MAX_FILE_BYTES) return { kind: 'unreadable' };
  const text = await readFile(file, 'utf8').catch(() => null);
  return text === null ? { kind: 'unreadable' } : { kind: 'text', text };
}

interface Tier {
  lists: RuleLists;
  problems: string[];
  failedSafe: boolean;
}

function failSafe(problem: string): Tier {
  const lists = RECOMMENDED_RULES.user;
  return { lists, problems: [`${problem}, so Spark uses its recommended rules`], failedSafe: true };
}

function tierFrom(read: RulesFileRead): Tier {
  if (read.kind === 'unreadable') return failSafe("The file can't be read");
  if (read.kind === 'missing') return { lists: NO_RULE_LISTS, problems: [], failedSafe: false };
  const parsed = parseRulesFile(read.text);
  if (parsed.malformed) return failSafe(parsed.problems[0] ?? 'The file is malformed');
  return { lists: parsed.lists, problems: parsed.problems, failedSafe: false };
}

export async function loadSparkRules(
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<LoadedRules> {
  const [managedRead, userRead] = await Promise.all([
    readRulesFile(files.managed),
    readRulesFile(files.user),
  ]);
  const managed = tierFrom(managedRead);
  const user = tierFrom(userRead);
  return {
    rules: { managed: managed.lists, user: user.lists },
    problems: [
      ...managed.problems.map((message) => ({ file: 'managed' as const, message })),
      ...user.problems.map((message) => ({ file: 'user' as const, message })),
    ],
    userFile: userRead,
    userFailedSafe: user.failedSafe,
  };
}

export async function floorRulesNow(
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRuleSet> {
  return (await loadSparkRules(files)).rules;
}

async function writeAtomically(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = join(dirname(file), `.${USER_RULES_NAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

let writing: Promise<unknown> = Promise.resolve();

export function changeSparkRules(
  files: SparkRulesFiles,
  change: (loaded: LoadedRules) => RuleChange,
): Promise<LoadedRules> {
  const next = writing.then(async () => {
    const loaded = await loadSparkRules(files);
    const { userFile } = loaded;
    if (userFile.kind === 'unreadable') {
      throw new RulesFileError("Spark's settings.json can't be read. Fix the file first.");
    }
    const current = userFile.kind === 'text' ? userFile.text : null;
    const text = changedRulesText(current, change(loaded));
    await writeAtomically(files.user, text);
    return loadSparkRules(files);
  });
  writing = next.catch(() => undefined);
  return next;
}
