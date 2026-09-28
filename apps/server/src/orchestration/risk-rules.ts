import {
  FOLLOW_UP_MINUTES,
  FOLLOW_UP_WORDS,
  LARGE_DIFF_FILES,
  LARGE_DIFF_LINES,
} from '../advisor/policy.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { namedFiles } from './context.ts';

const DESTRUCTIVE =
  /\b(?:delete|drop|truncate|wipe|purge|erase|destroy)\b|\brm\s+-\w*r|\breset\s+--hard\b|\bforce[- ]?push\b|\bpush\s+(?:-f|--force)\b|\brewrite (?:the )?(?:git )?history\b|\bmigrat\w*\b[^.\n]{0,40}\b(?:data|database|table|schema|column|rows?)\b|\bremove\s+(?:the |all |every )?(?:files?|folders?|director(?:y|ies)|tables?|columns?|rows?|records?|data|database|branch(?:es)?)\b/i;

const TRIVIAL_VERB =
  /\b(?:typos?|rename|reword|spelling|comment|comments|bump|format(?:ting)?|lint|whitespace|indent(?:ation)?)\b/i;

const REFERS_BACK = /\b(?:it|that|this|them|those|these|also|again|instead|same|too|as well)\b/i;

export const TRIVIAL_MAX_WORDS = 25;

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function namesSecret(request: string): boolean {
  const tokens = request.split(/[\s`'"(),;]+/).filter(Boolean);
  return tokens.some((token) => isSecretPath(token));
}

export function destructiveByRule(request: string): boolean {
  return DESTRUCTIVE.test(request) || namesSecret(request);
}

const MIGRATION = /\bmigrat(?:e|es|ed|ing|ion|ions)\b|\bschema changes?\b|\balter table\b/i;

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

function escaped(word: string): string {
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
  if (words(request) > TRIVIAL_MAX_WORDS) return false;
  if (namedFiles([request]).length > 1) return false;
  return TRIVIAL_VERB.test(request);
}

const REVIEW_PHRASE =
  /\b(?:review(?:er|ed)?|look (?:over|through)|check (?:my|the|these|our|this) (?:changes?|diff|work|code|branch|pr)|go over|second (?:opinion|pair of eyes))\b/i;
const ACTS_ON_REVIEW =
  /\b(?:address|fix|resolve|apply|handle)\b[^.]{0,30}\breview (?:comments?|feedback|notes|suggestions)\b/i;
const BUILD_VERB =
  /\b(?:add|build|create|implement|fix|write|refactor|rename|remove|delete|make|move|update|change|replace|migrate|convert|port|rewrite|extract|split|install)\b/i;

export function asksForReview(request: string): boolean {
  return REVIEW_PHRASE.test(request) && !ACTS_ON_REVIEW.test(request);
}

export function questionByRule(request: string): boolean {
  return request.trim().endsWith('?') && !BUILD_VERB.test(request);
}

export function followUpByRule(
  message: string,
  lastReplyAt: Date | null,
  now: Date = new Date(),
): boolean {
  const recent =
    lastReplyAt !== null && now.getTime() - lastReplyAt.getTime() <= FOLLOW_UP_MINUTES * 60_000;
  const short = words(message) <= FOLLOW_UP_WORDS && REFERS_BACK.test(message);
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
