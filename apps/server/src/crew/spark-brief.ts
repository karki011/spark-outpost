import { stat } from 'node:fs/promises';
import type { InstructionsFile, TeammateBrief } from '@spark-outpost/contracts';
import { folderInstructions } from '../persistence/teammates.ts';
import { briefWithFile, readInstructionsFile } from '../projects/instructions-file.ts';
import { crewSparksDir, sparkFolderPath } from './folders.ts';
import { readSparkInstructions } from './spark-folder.ts';
import { briefSkills } from './spark-skills.ts';

export interface StoredSparkBrief {
  id: string;
  name: string;
  role: string;
  instructions: string;
  instructionsMoved: boolean;
  instructionsPath: string | null;
}

async function existingFolder(sparksDir: string, sparkId: string): Promise<string | null> {
  const folder = sparkFolderPath(sparksDir, sparkId);
  const found = await stat(folder).catch(() => null);
  return found?.isDirectory() ? folder : null;
}

export async function sparkBrief(
  stored: StoredSparkBrief,
  sparksDir: string = crewSparksDir(),
  read: (requested: string) => Promise<InstructionsFile> = readInstructionsFile,
): Promise<TeammateBrief> {
  const inFolder = await readSparkInstructions(sparksDir, stored.id);
  const instructions = folderInstructions(
    { instructions: stored.instructions, moved: stored.instructionsMoved },
    inFolder,
  );
  const { name, role, instructionsPath } = stored;
  const typed = await briefWithFile({ name, role, instructions, instructionsPath }, read);
  const folder = await existingFolder(sparksDir, stored.id);
  const skills = folder ? await briefSkills(sparksDir, stored.id).catch(() => []) : [];
  return { ...typed, folder, skills };
}
