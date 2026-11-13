import { z } from 'zod';

export const CREW_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
export const CREW_SLUG_MAX = 40;
export const SPARK_INSTRUCTIONS_FILE = 'SPARK.md';
export const SKILL_FILE = 'SKILL.md';
export const SKILLS_FOLDER = 'skills';
export const CREW_FILE_MAX_BYTES = 256 * 1024;
export const CREW_FILES_MAX = 200;
export const CREW_PATH_MAX = 200;
export const CREW_PATH_DEPTH_MAX = 6;
export const SKILL_DESCRIPTION_MAX = 300;

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const crewSlugSchema = z.string().regex(CREW_SLUG_PATTERN);

export type CrewSlug = (name: string) => string;
export type CrewPathProblem = (path: string) => string | null;

export const crewSlug: CrewSlug = (name) => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const lettered = /^[a-z]/.test(base) ? base : `s-${base}`;
  const cut = lettered.slice(0, CREW_SLUG_MAX).replace(/-+$/, '');
  return cut.length < 2 ? `${cut}-1` : cut;
};

export const crewPathProblem: CrewPathProblem = (path) => {
  if (path.length === 0) return 'Enter a file name.';
  if (path.length > CREW_PATH_MAX) {
    return `A file path can have at most ${CREW_PATH_MAX} characters.`;
  }
  if (path.startsWith('/') || path.includes('\\')) {
    return 'Use a path inside the Spark folder, with forward slashes.';
  }
  const segments = path.split('/');
  if (segments.length > CREW_PATH_DEPTH_MAX) {
    return `A file can be at most ${CREW_PATH_DEPTH_MAX} folders deep.`;
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment)) {
      return 'Folder and file names use letters, numbers, dots, hyphens and underscores, and start with a letter or number.';
    }
  }
  return null;
};

export const crewPathSchema = z.string().refine((path) => crewPathProblem(path) === null);

export const skillSummarySchema = z.object({
  name: crewSlugSchema,
  description: z.string().min(1).max(SKILL_DESCRIPTION_MAX),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export interface ParsedSkillFile {
  skill: SkillSummary | null;
  body: string;
  problem: string | null;
}

export type ParseSkillFile = (text: string) => ParsedSkillFile;

function frontmatterFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
    fields.set(line.slice(0, colon).trim(), value);
  }
  return fields;
}

export const parseSkillFile: ParseSkillFile = (text) => {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (match === null) {
    return {
      skill: null,
      body: normalized,
      problem: `${SKILL_FILE} starts with a block between --- lines that holds name and description.`,
    };
  }
  const body = normalized.slice(match[0].length);
  const fields = frontmatterFields(match[1] ?? '');
  const parsed = skillSummarySchema.safeParse({
    name: fields.get('name'),
    description: fields.get('description'),
  });
  if (parsed.success) return { skill: parsed.data, body, problem: null };
  const missing = parsed.error.issues[0]?.path[0] === 'name' ? 'name' : 'description';
  return {
    skill: null,
    body,
    problem:
      missing === 'name'
        ? 'The skill needs a name in lower-case letters, numbers and hyphens.'
        : `The skill needs a description of at most ${SKILL_DESCRIPTION_MAX} characters.`,
  };
};

export type SkillOfPath = (path: string) => string | null;

export const skillOfPath: SkillOfPath = (path) => {
  const [folder, skill, ...rest] = path.split('/');
  if (folder !== SKILLS_FOLDER || skill === undefined || rest.length === 0) return null;
  return skill;
};

export const crewFileEntrySchema = z.object({
  path: crewPathSchema,
  bytes: z.number().int().nonnegative(),
});
export type CrewFileEntry = z.infer<typeof crewFileEntrySchema>;

export const sparkFolderSchema = z.object({
  sparkId: z.uuid(),
  files: z.array(crewFileEntrySchema).max(CREW_FILES_MAX),
  skills: z.array(skillSummarySchema),
  problems: z.array(z.object({ path: crewPathSchema, text: z.string() })),
});
export type SparkFolder = z.infer<typeof sparkFolderSchema>;

export const crewFileSchema = z.object({
  path: crewPathSchema,
  text: z.string(),
  hash: z.string(),
});
export type CrewFile = z.infer<typeof crewFileSchema>;

export const saveCrewFileSchema = z.object({
  path: crewPathSchema,
  text: z.string(),
  baseHash: z.string().nullable(),
});
export type SaveCrewFile = z.infer<typeof saveCrewFileSchema>;
