import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  INSTRUCTIONS_FILE_MAX_BYTES,
  TEAMMATE_INSTRUCTIONS_MAX,
  isInstructionsFileName,
  isSecretFileName,
  type InstructionsFile,
  type TeammateBrief,
} from '@spark-outpost/contracts';

const PROBLEMS = {
  relative: 'Choose a file by its full path.',
  kind: 'Use a Markdown or text file (.md, .markdown, .mdc or .txt).',
  secret: 'Secret files can’t be used as instructions.',
  missing: 'This file is missing.',
  unreadable: 'Spark Outpost can’t read this file.',
  notFile: 'That path is not a file.',
  large: 'This file is larger than 256 KB.',
  binary: 'This file is not plain text.',
} as const;

class InstructionsFileProblem extends Error {}

function assertUsable(target: string): void {
  const name = path.basename(target);
  if (isSecretFileName(name)) throw new InstructionsFileProblem(PROBLEMS.secret);
  if (!isInstructionsFileName(name)) throw new InstructionsFileProblem(PROBLEMS.kind);
}

async function realFile(requested: string): Promise<string> {
  try {
    return await realpath(requested);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new InstructionsFileProblem(missing ? PROBLEMS.missing : PROBLEMS.unreadable);
  }
}

async function readText(target: string): Promise<{ sizeBytes: number; text: string }> {
  const handle = await open(target, 'r').catch(() => {
    throw new InstructionsFileProblem(PROBLEMS.unreadable);
  });
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new InstructionsFileProblem(PROBLEMS.notFile);
    if (stats.size > INSTRUCTIONS_FILE_MAX_BYTES) throw new InstructionsFileProblem(PROBLEMS.large);
    const bytes = await handle.readFile();
    if (bytes.includes(0)) throw new InstructionsFileProblem(PROBLEMS.binary);
    try {
      return {
        sizeBytes: stats.size,
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      };
    } catch {
      throw new InstructionsFileProblem(PROBLEMS.binary);
    }
  } finally {
    await handle.close();
  }
}

export async function readInstructionsFile(requested: string): Promise<InstructionsFile> {
  const base = { path: requested, name: path.basename(requested) };
  try {
    if (!path.isAbsolute(requested)) throw new InstructionsFileProblem(PROBLEMS.relative);
    assertUsable(requested);
    const real = await realFile(requested);
    assertUsable(real);
    const { sizeBytes, text } = await readText(real);
    const trimmed = text.trim();
    return {
      ...base,
      sizeBytes,
      text: trimmed.slice(0, TEAMMATE_INSTRUCTIONS_MAX),
      truncated: trimmed.length > TEAMMATE_INSTRUCTIONS_MAX,
      problem: null,
    };
  } catch (error) {
    if (!(error instanceof InstructionsFileProblem)) throw error;
    return { ...base, sizeBytes: null, text: '', truncated: false, problem: error.message };
  }
}

export async function briefWithFile(
  brief: TeammateBrief & { instructionsPath: string | null },
  read: (requested: string) => Promise<InstructionsFile> = readInstructionsFile,
): Promise<TeammateBrief> {
  const typed = { name: brief.name, role: brief.role, instructions: brief.instructions };
  if (!brief.instructionsPath) return typed;
  const file = await read(brief.instructionsPath).catch(() => null);
  return file && !file.problem && file.text ? { ...typed, instructions: file.text } : typed;
}
