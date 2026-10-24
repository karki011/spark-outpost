import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { sparkDataDir } from '../config.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { RECOMMENDED_RULES, recommendedRulesText } from './recommended.ts';
import {
  acceptedOf,
  acceptedRead,
  acceptedRecordPath,
  acceptedRecordText,
  readAccepted,
  rulesTextHash,
  type AcceptedRules,
  type FileText,
} from './accepted.ts';
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
  outside: OutsideChange | null;
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

export type RulesFileRead = FileText;

const ABSENT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

function absentError(error: unknown): boolean {
  return ABSENT_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '');
}

export async function readRulesFile(file: string): Promise<RulesFileRead> {
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

export const OUTSIDE_CHANGE_PROBLEM =
  'The file changed outside Spark, so Spark keeps the rules you last accepted (its recommended rules if you never accepted any) until you review the change';

export interface OutsideChange {
  fileHash: string;
  acceptedHash: string;
  accepted: string | null;
}

const RECOMMENDED_BASELINE = acceptedOf({ kind: 'text', text: recommendedRulesText() });

function acceptedFor(read: RulesFileRead, recorded: AcceptedRules | null): AcceptedRules | null {
  return recorded ?? (read.kind === 'text' ? RECOMMENDED_BASELINE : null);
}

function outsideChangeOf(read: RulesFileRead, accepted: AcceptedRules | null) {
  if (!accepted || accepted.hash === rulesTextHash(read)) return null;
  return { fileHash: rulesTextHash(read), acceptedHash: accepted.hash, accepted: accepted.text };
}

export async function loadSparkRules(
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<LoadedRules> {
  const [managedRead, userRead, accepted] = await Promise.all([
    readRulesFile(files.managed),
    readRulesFile(files.user),
    readAccepted(files.user),
  ]);
  const outside = outsideChangeOf(userRead, accepted);
  const managed = tierFrom(managedRead);
  const user = tierFrom(outside && accepted ? acceptedRead(accepted) : userRead);
  const userProblems = outside ? [OUTSIDE_CHANGE_PROBLEM, ...user.problems] : user.problems;
  return {
    rules: { managed: managed.lists, user: user.lists },
    problems: [
      ...managed.problems.map((message) => ({ file: 'managed' as const, message })),
      ...userProblems.map((message) => ({ file: 'user' as const, message })),
    ],
    userFile: userRead,
    userFailedSafe: user.failedSafe,
    outside,
  };
}

export async function floorRulesNow(
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRuleSet> {
  return (await loadSparkRules(files)).rules;
}

async function writeAtomically(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function recordAccepted(files: SparkRulesFiles, accepted: AcceptedRules): Promise<void> {
  await writeAtomically(acceptedRecordPath(files.user), acceptedRecordText(accepted));
}

async function ensureBaseline(files: SparkRulesFiles): Promise<void> {
  if (await readAccepted(files.user)) return;
  const read = await readRulesFile(files.user);
  if (read.kind === 'unreadable') return;
  await recordAccepted(files, acceptedFor(read, null) ?? acceptedOf(read));
}

export class StaleRulesError extends RulesFileError {}

export const OUTSIDE_CHANGE_REFUSAL =
  'settings.json changed outside Spark. Review the change in Settings → Spark rules first.';

let writing: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = writing.then(work);
  writing = next.catch(() => undefined);
  return next;
}

export function acceptRulesBaseline(files: SparkRulesFiles = sparkRulesFiles()): Promise<void> {
  return serialized(() => ensureBaseline(files));
}

const SHOWN = 'the card was shown';
const REVIEWED = 'you reviewed it';

function checkedHash(
  read: RulesFileRead,
  expectedHash: string | undefined,
  name: string,
  moment = SHOWN,
) {
  if (expectedHash !== undefined && rulesTextHash(read) !== expectedHash) {
    throw new StaleRulesError(`${name} changed after ${moment}, so Spark changed nothing.`);
  }
}

function currentText(read: RulesFileRead, name: string): string | null {
  if (read.kind === 'unreadable') {
    throw new RulesFileError(`Spark's ${name} can't be read. Fix the file first.`);
  }
  return read.kind === 'text' ? read.text : null;
}

export function changeSparkRules(
  files: SparkRulesFiles,
  change: (loaded: LoadedRules) => RuleChange,
  expectedHash?: string,
): Promise<LoadedRules> {
  return serialized(async () => {
    await ensureBaseline(files);
    const loaded = await loadSparkRules(files);
    if (loaded.outside) throw new RulesFileError(OUTSIDE_CHANGE_REFUSAL);
    checkedHash(loaded.userFile, expectedHash, USER_RULES_NAME);
    const text = changedRulesText(currentText(loaded.userFile, USER_RULES_NAME), change(loaded));
    await writeAtomically(files.user, text);
    await recordAccepted(files, acceptedOf({ kind: 'text', text }));
    return loadSparkRules(files);
  });
}

export type ManagedWrite = (file: string, text: string, previousHash: string) => Promise<void>;

export function changeManagedRules(
  files: SparkRulesFiles,
  change: RuleChange,
  expectedHash: string,
  write: ManagedWrite,
): Promise<LoadedRules> {
  return serialized(async () => {
    const read = await readRulesFile(files.managed);
    checkedHash(read, expectedHash, basename(files.managed));
    const text = changedRulesText(currentText(read, basename(files.managed)), change);
    await write(files.managed, text, rulesTextHash(read));
    return loadSparkRules(files);
  });
}

export function acceptOutsideChange(
  files: SparkRulesFiles,
  fileHash: string,
): Promise<LoadedRules> {
  return serialized(async () => {
    const read = await readRulesFile(files.user);
    checkedHash(read, fileHash, USER_RULES_NAME, REVIEWED);
    currentText(read, USER_RULES_NAME);
    await recordAccepted(files, acceptedOf(read));
    return loadSparkRules(files);
  });
}

export function restoreAcceptedRules(
  files: SparkRulesFiles,
  fileHash: string,
): Promise<LoadedRules> {
  return serialized(async () => {
    const read = await readRulesFile(files.user);
    checkedHash(read, fileHash, USER_RULES_NAME, REVIEWED);
    const accepted = acceptedFor(read, await readAccepted(files.user));
    if (!accepted) return loadSparkRules(files);
    if (accepted.text === null) await rm(files.user, { force: true });
    else await writeAtomically(files.user, accepted.text);
    await recordAccepted(files, accepted);
    return loadSparkRules(files);
  });
}
