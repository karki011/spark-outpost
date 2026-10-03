import {
  FOLLOW_UP_MINUTES,
  FOLLOW_UP_WORDS,
  LARGE_DIFF_FILES,
  LARGE_DIFF_LINES,
} from '../advisor/policy.ts';
import { namedFiles } from './context.ts';

const DESTRUCTIVE =
  /\b(?:delete|drop|truncate|wipe|purge|erase|destroy)\b|\brm\s+-\w*r|\breset\s+--hard\b|\bforce[- ]?push\b|\bpush\s+(?:-f|--force)\b|\brewrite (?:the )?(?:git )?history\b|\bmigrat\w*\b[^.\n]{0,40}\b(?:data|rows?|records?)\b|\brenam\w*\b[^.\n]{0,40}\b(?:columns?|tables?)\b|\b(?:alter|change)\w*\b[^.\n]{0,40}\bcolumn\b[^.\n]{0,40}\btypes?\b|\bcolumn types?\b|\bremove\s+(?:the |all |every )?(?:files?|folders?|director(?:y|ies)|tables?|columns?|rows?|records?|data|database|branch(?:es)?)\b/i;

const TRIVIAL_VERB =
  /\b(?:typos?|rename|reword|spelling|comment|comments|bump|format(?:ting)?|lint|whitespace|indent(?:ation)?)\b/i;

const REFERS_BACK = /\b(?:it|that|this|them|those|these|also|again|instead|same|too|as well)\b/i;

const TRIVIAL_MAX_WORDS = 25;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const FOREIGN_KEY_ACTION =
  /\bon\s+(?:delete|update)\s+(?:cascade|set\s+null|set\s+default|restrict|no\s+action)\b|\bcascad\w*\s+delet\w*|\bdelet\w*\s+cascad\w*/gi;

const STRONG_REMOVAL =
  /\b(?:drop\s+(?:table|column|schema|database|type)|delete\s+from|truncate(?:\s+table)?)\b|\b(?:delete|drop|remove|purge|wipe|erase|destroy|truncate)\w*\s+(?:(?!(?:to|for|on|in|of|with|at|by|button|event|handler|endpoint|action|icon|link|option|menu|modal|dialog|key|route|api|confirm\w*)\b)\w+\s+){0,3}(?:data|rows?|records?|tables?|columns?|database|db|files?|folders?|director(?:y|ies)|branch(?:es)?|history|users?|accounts?|uploads?|backups?|entries|logs?)\b|\brenam\w*\b[^.\n]{0,40}\b(?:columns?|tables?)\b|\b(?:alter|change)\w*\b[^.\n]{0,40}\bcolumn\b[^.\n]{0,40}\btypes?\b|\bmigrat\w*\b[^.\n]{0,40}\b(?:data|rows?|records?)\b|\brm\s+-\w*r|\breset\s+--hard\b|\bforce[- ]?push\b|\bpush\s+(?:-f|--force)\b|\brewrite (?:the )?(?:git )?history\b/i;

function withoutForeignKeyActions(text: string): string {
  return text.replace(FOREIGN_KEY_ACTION, ' ');
}

export function destructiveByRule(request: string): boolean {
  return DESTRUCTIVE.test(withoutForeignKeyActions(request));
}

export function strongRemovalByRule(request: string): boolean {
  return STRONG_REMOVAL.test(withoutForeignKeyActions(request));
}

export function destructiveTargets(request: string): string[] {
  const parts = request.split(/\n|(?<=[.!?;])\s+/);
  return namedFiles(parts.filter((part) => destructiveByRule(part)));
}

const MIGRATION = /\bmigrat(?:e|es|ed|ing|ion|ions)\b|\bschema changes?\b|\balter table\b/i;

const DESTRUCTIVE_SCHEMA_WORDING =
  /\b(?:drop(?:s|ped|ping)?|truncat\w*|delet(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|purg\w*|wip(?:e|es|ed|ing))\b|\brenam\w*\b[^.\n]{0,40}\b(?:columns?|tables?|fields?)\b|\b(?:columns?|tables?)\b[^.\n]{0,40}\brenam\w*|\bcolumn types?\b|\b(?:alter|chang)\w*\b[^.\n]{0,40}\btypes?\b|\b(?:backfill|rewrit|convert|transform|migrat)\w*\b[^.\n]{0,40}\b(?:existing |old )?(?:data|rows?|records?|values?)\b|\bupdate (?:all|every|the existing|existing) (?:rows|records)\b/i;

export function migrationByRule(request: string): boolean {
  return MIGRATION.test(request);
}

export function destructiveMigrationWording(request: string): boolean {
  return (
    MIGRATION.test(request) && DESTRUCTIVE_SCHEMA_WORDING.test(withoutForeignKeyActions(request))
  );
}

export function additiveMigrationWording(request: string): boolean {
  return (
    MIGRATION.test(request) &&
    !DESTRUCTIVE_SCHEMA_WORDING.test(withoutForeignKeyActions(request)) &&
    !destructiveByRule(request)
  );
}

const MIGRATION_FILE =
  /(?:^|\/)(?:migrations?|migrate|db\/migrate|alembic\/versions|schema)\/|\.sql$|(?:^|\/)schema\.prisma$/i;

const DESTRUCTIVE_SQL: readonly RegExp[] = [
  /\bdrop\s+(?:table|column|schema|database|type)\b/i,
  /\balter\s+table\b[^;]*\bdrop\b(?!\s+(?:constraint|index|default|not\s+null)\b)/i,
  /\brename\s+(?:column\b|to\b)/i,
  /\balter\s+table\b[^;]*\brename\b/i,
  /\balter\s+(?:column\s+)?\S+\s+(?:set\s+data\s+)?type\b/i,
  /\bmodify\s+(?:column\s+)?\S+\s+\w+/i,
  /\btruncate\b/i,
  /\b(?:dropTable|dropColumn|dropColumns|renameColumn|renameTable|dropSchema)\s*\(/,
];

const UNSCOPED_WRITE = /^\s*(?:delete\s+from|update)\b(?![\s\S]*\bwhere\b)/i;

interface PatchFile {
  path: string;
  added: string[];
}

function patchFiles(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[1]!, added: [] };
      files.push(current);
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) {
      current.added.push(line.slice(1));
    }
  }
  return files;
}

function statements(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function destructiveMigrationInPatch(patch: string): string | null {
  for (const file of patchFiles(patch)) {
    if (!MIGRATION_FILE.test(file.path)) continue;
    for (const statement of statements(file.added)) {
      if (DESTRUCTIVE_SQL.some((pattern) => pattern.test(statement))) return statement;
      if (UNSCOPED_WRITE.test(statement)) return statement;
    }
  }
  return null;
}

const SECURITY =
  /\b(?:security|auth(?:entic\w*|oriz\w*|n|z)?|login|passwords?|permissions?|oauth|jwt|csrf|xss|(?:sql|command|prompt) injection|encrypt\w*|decrypt\w*|cryptograph\w*|vulnerab\w*|secrets?)\b/i;

const MULTI_PACKAGE =
  /\b(?:across|every|all|multiple|several)\s+(?:the\s+|our\s+)?(?:packages|modules|services|apps|workspaces|repos|repositories)\b|\bmonorepo\b|\bacross the (?:code ?base|repo(?:sitory)?|project)\b|\bcode ?base[- ]wide\b/i;

const TOP_MODEL =
  /\b(?:strongest|most capable|smartest|biggest|best available|top[- ]tier|top)\s+model\b/i;

export type ComplexRule = 'migration' | 'security' | 'multi-package';

export function complexByRule(request: string): ComplexRule | null {
  if (MIGRATION.test(request)) return 'migration';
  if (SECURITY.test(request)) return 'security';
  if (MULTI_PACKAGE.test(request)) return 'multi-package';
  return null;
}

export function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function asksForTopModel(request: string, topFamilies: readonly string[] = []): boolean {
  if (TOP_MODEL.test(request)) return true;
  return topFamilies
    .filter((family) => family.length >= 3)
    .some((family) => new RegExp(`\\b${escaped(family)}\\b`, 'i').test(request));
}

export function trivialByRule(request: string): boolean {
  if (destructiveByRule(request)) return false;
  if (wordCount(request) > TRIVIAL_MAX_WORDS) return false;
  if (namedFiles([request]).length > 1) return false;
  return TRIVIAL_VERB.test(request);
}

const REVIEW_PHRASE =
  /\b(?:review(?:er|ed)?|look (?:over|through)|check (?:my|the|these|our|this) (?:changes?|diff|work|code|branch|pr)|go over|second (?:opinion|pair of eyes))\b/i;
const ACTS_ON_REVIEW =
  /\b(?:address|fix|resolve|apply|handle)\b[^.]{0,30}\breview (?:comments?|feedback|notes|suggestions)\b/i;
export const BUILD_VERB =
  /\b(?:add|build|create|implement|fix|write|refactor|rename|remove|delete|make|move|update|change|replace|migrate|convert|port|rewrite|extract|split|install)\b/i;

export function asksForReview(request: string): boolean {
  return REVIEW_PHRASE.test(request) && !ACTS_ON_REVIEW.test(request);
}

const EXISTING_CHANGES =
  /\b(?:uncommitted|unstaged|staged|unpushed|pending|local|working[- ]tree|git diff)\b|\b(?:my|our|these|this|the|current|recent|latest)\s+(?:\w+\s+)?(?:changes?|diff|edits|commits?|branch|pr|pull request|patch|work)\b/i;
const THEN_CHANGE =
  /\b(?:and|then)\s+(?:please\s+)?(?:fix|apply|address|change|update|implement|make|clean up)\b|\bfix (?:what|anything|everything|any|all)\b/i;

const LEADS_WITH_REVIEW =
  /^\s*(?:(?:please|can you|could you|would you|kindly)\s+)?(?:review|look (?:over|through|at)|check|go over|give (?:me )?a (?:review|second opinion) (?:of|on))\b/i;

export function reviewsExistingByRule(request: string): boolean {
  const first = request.trim().split(/[.!?\n]/, 1)[0] ?? '';
  if (!LEADS_WITH_REVIEW.test(first) || !EXISTING_CHANGES.test(first)) return false;
  return !THEN_CHANGE.test(request);
}

const PLAN_ONLY_PHRASE =
  /\bplan[- ]only\b|\bonly (?:a |the |make a |write a )?plan\b|\bjust (?:a |the )?plan\b|\bjust plan\b/i;
const PLAN_VERB_FIRST =
  /^\s*(?:please\s+|can you\s+|could you\s+)?(?:plan(?: out)?|draft a plan|write (?:up )?a plan|make a plan|come up with a plan|propose a plan|sketch (?:out )?a plan)\b/i;
const PLAN_ASK =
  /\b(?:write|draft|make|give me|come up with|put together|propose|sketch)\s+(?:me\s+)?(?:up\s+)?(?:a|an)\s+(?:\w+\s+){0,2}plan\b/i;
const PLAN_THEN_BUILD =
  /\bplan\b[^.\n]{0,60}\b(?:and|then)\s+(?:then\s+)?(?:build|implement|do|make|code|start)\b|\bthen (?:build|implement) it\b/i;

export function planOnlyByRule(request: string): boolean {
  if (PLAN_ONLY_PHRASE.test(request)) return true;
  if (!PLAN_VERB_FIRST.test(request) && !PLAN_ASK.test(request)) return false;
  return !PLAN_THEN_BUILD.test(request);
}

const ASKS_FOR_ANSWER =
  /\b(?:any (?:feedback|thoughts|ideas|suggestions|concerns)|what do you think|your (?:thoughts|opinion|take)|(?:give|show|tell) me (?:a |the |your |some )?(?:\w+\s+)?(?:plan|summary|overview|details|feedback)|let'?s (?:plan|discuss|think)|summari[sz]e)\b/i;

const LEADS_WITH_BUILD = new RegExp(
  `^\\s*(?:(?:please|can you|could you|would you|let'?s|go ahead and)\\s+)?${BUILD_VERB.source}`,
  'i',
);

const LEADS_WITH_RUN =
  /^\s*(?:(?:please|now|can you|could you|would you|go ahead and|just)\s+)*(?:run|execute|fetch|curl)\b/i;
const NAMED_COMMAND = /`[^`\n]+`|\bhttps?:\/\/\S+/g;

export function runsCommandsByRule(request: string): boolean {
  if (!LEADS_WITH_RUN.test(request)) return false;
  const prose = request.replace(NAMED_COMMAND, ' ');
  return prose !== request && !BUILD_VERB.test(prose);
}

const ASKS_HOW_OR_WHY =
  /^\s*(?:how (?:do|does|did|should|to|is|are)\b|how (?:can|could|would)\b(?! you\b)|what(?:['’]s)?\b(?! if\b)|why\b(?! (?:not|don['’]?t|can['’]?t|won['’]?t)\b)|where\b|when\b|which\b|who\b|(?:is|are) there\b|(?:does|do|is|are|should) (?:spark|i|it|we|the|builders?)\b|(?:can|could) (?:spark|i|builders?)\b)/i;

export function questionByRule(request: string): boolean {
  if (THEN_CHANGE.test(request)) return false;
  if (runsCommandsByRule(request)) return true;
  if (ASKS_FOR_ANSWER.test(request)) return true;
  if (!request.trim().endsWith('?')) return false;
  return ASKS_HOW_OR_WHY.test(request) || !BUILD_VERB.test(request);
}

export function buildsByRule(request: string): boolean {
  return LEADS_WITH_BUILD.test(request);
}

export function followUpByRule(
  message: string,
  lastReplyAt: Date | null,
  now: Date = new Date(),
): boolean {
  const recent =
    lastReplyAt !== null && now.getTime() - lastReplyAt.getTime() <= FOLLOW_UP_MINUTES * 60_000;
  const short = wordCount(message) <= FOLLOW_UP_WORDS && REFERS_BACK.test(message);
  return recent || short;
}

const NOT_COUNTED =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:dist|build|generated|__generated__)\/|\.min\.(?:js|css)$|\.snap$/;

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
}

export function isLargeDiff(files: readonly DiffFile[]): boolean {
  const counted = files.filter((file) => !NOT_COUNTED.test(file.path));
  const lines = counted.reduce((total, file) => total + file.additions + file.deletions, 0);
  return lines >= LARGE_DIFF_LINES || counted.length >= LARGE_DIFF_FILES;
}
