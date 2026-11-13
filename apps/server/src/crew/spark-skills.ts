import path from 'node:path';
import {
  CREW_FILES_MAX,
  SKILLS_FOLDER,
  SKILL_FILE,
  parseSkillFile,
  skillOfPath,
  type SkillSummary,
  type SparkFolder,
} from '@spark-outpost/contracts';
import { sparkFolderPath } from './folders.ts';
import { CrewFileProblemError, crewFileEntries, readCrewFile } from './spark-folder.ts';

type FolderProblem = SparkFolder['problems'][number];

interface SkillRead {
  skill: SkillSummary | null;
  problem: FolderProblem | null;
}

const SKILL_PROBLEMS = {
  missing: `This skill has no ${SKILL_FILE}.`,
  name: 'The name in the skill’s file must match its folder name.',
  truncated: `Only the first ${CREW_FILES_MAX} files are shown.`,
} as const;

async function readSkill(sparksDir: string, sparkId: string, folderName: string) {
  const file = `${SKILLS_FOLDER}/${folderName}/${SKILL_FILE}`;
  const failed = (text: string): SkillRead => ({ skill: null, problem: { path: file, text } });
  try {
    const parsed = parseSkillFile((await readCrewFile(sparksDir, sparkId, file)).text);
    if (!parsed.skill) return failed(parsed.problem ?? SKILL_PROBLEMS.name);
    if (parsed.skill.name !== folderName) return failed(SKILL_PROBLEMS.name);
    return { skill: parsed.skill, problem: null };
  } catch (error) {
    if (error instanceof CrewFileProblemError) return failed(error.message);
    throw error;
  }
}

export async function sparkFolder(sparksDir: string, sparkId: string): Promise<SparkFolder> {
  const { files, truncated } = await crewFileEntries(sparksDir, sparkId);
  const paths = new Set(files.map((file) => file.path));
  const folders = [...new Set(files.flatMap((file) => skillOfPath(file.path) ?? []))].sort();
  const skills: SkillSummary[] = [];
  const problems: FolderProblem[] = [];
  for (const folderName of folders) {
    if (!paths.has(`${SKILLS_FOLDER}/${folderName}/${SKILL_FILE}`)) {
      problems.push({ path: `${SKILLS_FOLDER}/${folderName}`, text: SKILL_PROBLEMS.missing });
      continue;
    }
    const read = await readSkill(sparksDir, sparkId, folderName);
    if (read.skill) skills.push(read.skill);
    if (read.problem) problems.push(read.problem);
  }
  if (truncated) problems.push({ path: SKILLS_FOLDER, text: SKILL_PROBLEMS.truncated });
  return { sparkId, files, skills, problems };
}

export interface BriefSkill extends SkillSummary {
  folder: string;
}

export async function briefSkills(sparksDir: string, sparkId: string): Promise<BriefSkill[]> {
  const { skills } = await sparkFolder(sparksDir, sparkId);
  const base = path.join(sparkFolderPath(sparksDir, sparkId), SKILLS_FOLDER);
  return skills.map((skill) => ({ ...skill, folder: path.join(base, skill.name) }));
}
