import {
  CREW_EDIT_FILES_MAX,
  CREW_EDIT_TEXT_MAX_BYTES,
  CREW_FILES_MAX,
  SKILLS_FOLDER,
  SKILL_FILE,
  crewPathProblem,
  parseSkillFile,
  skillOfPath,
  type CrewFile,
  type CrewFileChange,
  type SkillSummary,
} from '@spark-outpost/contracts';
import {
  CREW_PROBLEMS,
  CrewFileNotFoundError,
  CrewFileProblemError,
  crewFileEntries,
  crewTextProblem,
  readCrewFile,
} from './spark-folder.ts';

export interface CrewFileInput {
  path: string;
  text: string | null;
}

export interface CrewProblem {
  path: string;
  text: string;
}

export interface SparkEditPlan {
  files: CrewFileChange[];
  problems: CrewProblem[];
  newSkills: SkillSummary[];
}

export const CREW_EDIT_PROBLEMS = {
  twice: 'This path is in the call twice.',
  noFile: 'There is no file here to delete.',
  noSkill: 'There is no skill folder with this name.',
  skillFile: `A skill folder needs a ${SKILL_FILE} that starts with name and description between --- lines. Add it in the same call.`,
  skillLeft: `Deleting ${SKILL_FILE} leaves the skill’s other files without it. Pass remove with the skill’s name to delete the whole folder.`,
  inTheWay: 'Another file in this change has this path as a folder.',
  tooMany: `One call can change at most ${CREW_EDIT_FILES_MAX} files. Split it into several calls.`,
  tooLarge: `One call can carry at most ${Math.round(CREW_EDIT_TEXT_MAX_BYTES / 1024)} KB of text, before and after together. Split it into several calls.`,
} as const;

export function skillNameProblem(folder: string): string {
  return `The name in ${SKILL_FILE} must be ${folder}, the same as its folder.`;
}

async function currentFile(
  sparksDir: string,
  sparkId: string,
  path: string,
): Promise<CrewFile | null> {
  try {
    return await readCrewFile(sparksDir, sparkId, path);
  } catch (error) {
    if (error instanceof CrewFileNotFoundError) return null;
    throw error;
  }
}

function skillPrefix(folder: string): string {
  return `${SKILLS_FOLDER}/${folder}/`;
}

function withRemovedSkill(
  inputs: readonly CrewFileInput[],
  removeSkill: string | null,
  existing: readonly string[],
  problems: CrewProblem[],
): CrewFileInput[] {
  if (removeSkill === null) return [...inputs];
  const inFolder = existing.filter((path) => path.startsWith(skillPrefix(removeSkill)));
  if (inFolder.length === 0) {
    problems.push({
      path: `${SKILLS_FOLDER}/${removeSkill}`,
      text: CREW_EDIT_PROBLEMS.noSkill,
    });
  }
  return [...inputs, ...inFolder.map((path) => ({ path, text: null }))];
}

async function changeOf(
  sparksDir: string,
  sparkId: string,
  input: CrewFileInput,
): Promise<CrewFileChange | CrewProblem | null> {
  const { path, text } = input;
  const pathProblem = crewPathProblem(path);
  if (pathProblem) return { path, text: pathProblem };
  const textProblem = text === null ? null : crewTextProblem(text);
  if (textProblem) return { path, text: textProblem };
  let current: CrewFile | null;
  try {
    current = await currentFile(sparksDir, sparkId, path);
  } catch (error) {
    if (error instanceof CrewFileProblemError) return { path, text: error.message };
    throw error;
  }
  if (text === null) {
    if (!current) return { path, text: CREW_EDIT_PROBLEMS.noFile };
    return { path, change: 'deleted', before: current.text, after: null, baseHash: current.hash };
  }
  if (!current) return { path, change: 'new', before: null, after: text, baseHash: null };
  if (current.text === text) return null;
  return { path, change: 'changed', before: current.text, after: text, baseHash: current.hash };
}

function isChange(result: CrewFileChange | CrewProblem): result is CrewFileChange {
  return 'change' in result;
}

function ancestors(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

function skillProblems(files: readonly CrewFileChange[], after: ReadonlySet<string>) {
  const problems: CrewProblem[] = [];
  const newSkills: SkillSummary[] = [];
  const folders = new Set(files.flatMap((file) => skillOfPath(file.path) ?? []));
  for (const folder of folders) {
    const skillFile = `${skillPrefix(folder)}${SKILL_FILE}`;
    const others = [...after].some((path) => path.startsWith(skillPrefix(folder)));
    const written = files.find((file) => file.path === skillFile);
    if (others && !after.has(skillFile)) {
      problems.push({
        path: `${SKILLS_FOLDER}/${folder}`,
        text: written ? CREW_EDIT_PROBLEMS.skillLeft : CREW_EDIT_PROBLEMS.skillFile,
      });
    }
    if (!written || written.after === null) continue;
    const parsed = parseSkillFile(written.after);
    if (!parsed.skill) {
      problems.push({ path: skillFile, text: parsed.problem ?? CREW_EDIT_PROBLEMS.skillFile });
    } else if (parsed.skill.name !== folder) {
      problems.push({ path: skillFile, text: skillNameProblem(folder) });
    } else if (written.change === 'new') {
      newSkills.push(parsed.skill);
    }
  }
  return { problems, newSkills };
}

function sizeProblems(files: readonly CrewFileChange[], after: ReadonlySet<string>): CrewProblem[] {
  const problems: CrewProblem[] = [];
  if (files.length > CREW_EDIT_FILES_MAX) {
    problems.push({ path: '', text: CREW_EDIT_PROBLEMS.tooMany });
  }
  if (after.size > CREW_FILES_MAX) problems.push({ path: '', text: CREW_PROBLEMS.full });
  const bytes = files.reduce(
    (sum, file) => sum + Buffer.byteLength(`${file.before ?? ''}${file.after ?? ''}`, 'utf8'),
    0,
  );
  if (bytes > CREW_EDIT_TEXT_MAX_BYTES) {
    problems.push({ path: '', text: CREW_EDIT_PROBLEMS.tooLarge });
  }
  return problems;
}

export async function planSparkEdit(
  sparksDir: string,
  sparkId: string,
  inputs: readonly CrewFileInput[],
  removeSkill: string | null,
): Promise<SparkEditPlan> {
  const existing = (await crewFileEntries(sparksDir, sparkId)).files.map((file) => file.path);
  const problems: CrewProblem[] = [];
  const wanted = withRemovedSkill(inputs, removeSkill, existing, problems);
  const seen = new Set<string>();
  const files: CrewFileChange[] = [];
  for (const input of wanted) {
    if (seen.has(input.path)) {
      problems.push({ path: input.path, text: CREW_EDIT_PROBLEMS.twice });
      continue;
    }
    seen.add(input.path);
    const result = await changeOf(sparksDir, sparkId, input);
    if (result === null) continue;
    if (isChange(result)) files.push(result);
    else problems.push(result);
  }
  const after = new Set(existing);
  for (const file of files) {
    if (file.change === 'deleted') after.delete(file.path);
    else after.add(file.path);
  }
  for (const file of files) {
    if (file.change === 'deleted') continue;
    if (ancestors(file.path).some((folder) => after.has(folder))) {
      problems.push({ path: file.path, text: CREW_EDIT_PROBLEMS.inTheWay });
    }
  }
  const skills = skillProblems(files, after);
  return {
    files,
    problems: [...problems, ...skills.problems, ...sizeProblems(files, after)],
    newSkills: skills.newSkills,
  };
}
