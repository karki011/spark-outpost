import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DEFAULT_SPARK_RULES } from '@spark-outpost/contracts';
import { sparkDataDir } from '../config.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { recommendedRulesText, type GhSeed } from './recommended.ts';
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
  managedFile: RulesFileRead;
  outside: OutsideChange | null;
}

export const MANAGED_RULES_FILE = '/Library/Application Support/SparkOutpost/managed-settings.json';
export const USER_RULES_NAME = 'settings.json';
export const SEEDED_MARKER = '.settings-seeded';
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

export function seededMarker(files: SparkRulesFiles): string {
  return join(dirname(files.user), SEEDED_MARKER);
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null)) !== null;
}

export type RulesFileRead = FileText;

export async function readRulesFile(file: string): Promise<RulesFileRead> {
  const found = await stat(file).catch(() => null);
  if (!found) return { kind: 'missing' };
  if (!found.isFile() || found.size > MAX_FILE_BYTES) return { kind: 'unreadable' };
  const text = await readFile(file, 'utf8').catch(() => null);
  return text === null ? { kind: 'unreadable' } : { kind: 'text', text };
}

interface Tier {
  lists: RuleLists;
  problems: string[];
}

function failSafe(gh: GhSeed, problem: string): Tier {
  const lists = parseRulesFile(recommendedRulesText(gh)).lists;
  return { lists, problems: [`${problem}, so Spark uses its recommended rules`] };
}

function tierFrom(read: RulesFileRead, gh: GhSeed): Tier {
  if (read.kind === 'unreadable') return failSafe(gh, "The file can't be read");
  if (read.kind === 'missing') return { lists: NO_RULE_LISTS, problems: [] };
  const parsed = parseRulesFile(read.text);
  if (parsed.malformed) return failSafe(gh, parsed.problems[0] ?? 'The file is malformed');
  return { lists: parsed.lists, problems: parsed.problems };
}

async function userTier(files: SparkRulesFiles, gh: GhSeed, read: RulesFileRead): Promise<Tier> {
  if (read.kind !== 'missing' || (await exists(seededMarker(files)))) return tierFrom(read, gh);
  return { lists: parseRulesFile(recommendedRulesText(gh)).lists, problems: [] };
}

export const OUTSIDE_CHANGE_PROBLEM =
  'The file changed outside Spark, so Spark keeps the rules you last accepted until you review the change';

export interface OutsideChange {
  fileHash: string;
  acceptedHash: string;
  accepted: string | null;
}

function outsideChangeOf(read: RulesFileRead, accepted: AcceptedRules | null) {
  if (!accepted || accepted.hash === rulesTextHash(read)) return null;
  return { fileHash: rulesTextHash(read), acceptedHash: accepted.hash, accepted: accepted.text };
}

export async function loadSparkRules(files: SparkRulesFiles, gh: GhSeed): Promise<LoadedRules> {
  const [managedRead, userRead, accepted] = await Promise.all([
    readRulesFile(files.managed),
    readRulesFile(files.user),
    readAccepted(files.user),
  ]);
  const outside = outsideChangeOf(userRead, accepted);
  const managed = tierFrom(managedRead, gh);
  const user = await userTier(files, gh, outside && accepted ? acceptedRead(accepted) : userRead);
  const userProblems = outside ? [OUTSIDE_CHANGE_PROBLEM, ...user.problems] : user.problems;
  return {
    rules: { managed: managed.lists, user: user.lists },
    problems: [
      ...managed.problems.map((message) => ({ file: 'managed' as const, message })),
      ...userProblems.map((message) => ({ file: 'user' as const, message })),
    ],
    userFile: userRead,
    managedFile: managedRead,
    outside,
  };
}

export async function floorRulesNow(
  files: SparkRulesFiles = sparkRulesFiles(),
): Promise<SparkRuleSet> {
  return (await loadSparkRules(files, DEFAULT_SPARK_RULES)).rules;
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

async function acceptFirstRead(files: SparkRulesFiles): Promise<void> {
  if (await readAccepted(files.user)) return;
  const read = await readRulesFile(files.user);
  if (read.kind !== 'unreadable') await recordAccepted(files, acceptedOf(read));
}

export async function seedSparkRules(files: SparkRulesFiles, gh: GhSeed): Promise<boolean> {
  if ((await exists(files.user)) || (await exists(seededMarker(files)))) {
    await acceptFirstRead(files);
    return false;
  }
  const text = recommendedRulesText(gh);
  await writeAtomically(files.user, text);
  await writeFile(seededMarker(files), `${new Date().toISOString()}\n`, { mode: 0o600 });
  await recordAccepted(files, acceptedOf({ kind: 'text', text }));
  return true;
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

function checkedHash(read: RulesFileRead, expectedHash: string | undefined, name: string) {
  if (expectedHash !== undefined && rulesTextHash(read) !== expectedHash) {
    throw new StaleRulesError(
      `${name} changed after the card was shown, so Spark changed nothing.`,
    );
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
  gh: GhSeed,
  change: (loaded: LoadedRules) => RuleChange,
  expectedHash?: string,
): Promise<LoadedRules> {
  return serialized(async () => {
    await seedSparkRules(files, gh);
    const loaded = await loadSparkRules(files, gh);
    if (loaded.outside) throw new RulesFileError(OUTSIDE_CHANGE_REFUSAL);
    checkedHash(loaded.userFile, expectedHash, USER_RULES_NAME);
    const text = changedRulesText(currentText(loaded.userFile, USER_RULES_NAME), change(loaded));
    await writeAtomically(files.user, text);
    await recordAccepted(files, acceptedOf({ kind: 'text', text }));
    return loadSparkRules(files, gh);
  });
}

export type ManagedWrite = (file: string, text: string) => Promise<void>;

export function changeManagedRules(
  files: SparkRulesFiles,
  gh: GhSeed,
  change: RuleChange,
  expectedHash: string,
  write: ManagedWrite,
): Promise<LoadedRules> {
  return serialized(async () => {
    const read = await readRulesFile(files.managed);
    checkedHash(read, expectedHash, basename(files.managed));
    await write(
      files.managed,
      changedRulesText(currentText(read, basename(files.managed)), change),
    );
    return loadSparkRules(files, gh);
  });
}

export function acceptOutsideChange(
  files: SparkRulesFiles,
  gh: GhSeed,
  fileHash: string,
): Promise<LoadedRules> {
  return serialized(async () => {
    const read = await readRulesFile(files.user);
    checkedHash(read, fileHash, USER_RULES_NAME);
    currentText(read, USER_RULES_NAME);
    await recordAccepted(files, acceptedOf(read));
    return loadSparkRules(files, gh);
  });
}

export function restoreAcceptedRules(files: SparkRulesFiles, gh: GhSeed): Promise<LoadedRules> {
  return serialized(async () => {
    const accepted = await readAccepted(files.user);
    if (accepted?.text != null) await writeAtomically(files.user, accepted.text);
    else if (accepted) await rm(files.user, { force: true });
    return loadSparkRules(files, gh);
  });
}
