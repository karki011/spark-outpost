import type { JevIntake } from '@spark-outpost/contracts';
import {
  BROAD_SCAN_FILES,
  BROAD_SCAN_PACKAGES,
  BROAD_SCAN_SCORE,
  COMPLEX_JEV_AT,
  SMALL_JEV_AT,
} from '../advisor/policy.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { namedFiles } from './context.ts';
import { asksForTopModel, complexByRule, trivialByRule } from './risk-rules.ts';

export type ComplexSource = 'user' | 'rules' | 'scan' | 'jev';

export interface ComplexSignal {
  source: ComplexSource;
  reason: string;
}

type JevSize = Pick<JevIntake, 'tier' | 'routeConfidence'> & Partial<Pick<JevIntake, 'complexity'>>;

export function complexByRequest(
  request: string | undefined,
  topFamilies: readonly string[] = [],
): ComplexSignal | null {
  if (!request) return null;
  if (asksForTopModel(request, topFamilies)) {
    return { source: 'user', reason: 'asked for the top model' };
  }
  const rule = complexByRule(request);
  return rule ? { source: 'rules', reason: rule } : null;
}

export function complexByScan(report: ScanReport | null | undefined): ComplexSignal | null {
  if (!report) return null;
  const likely = report.candidates.filter(
    (file) => file.termsMatched > 0 && file.score >= BROAD_SCAN_SCORE,
  );
  const packages = new Set(likely.map((file) => file.package).filter((name) => name !== '.'));
  if (packages.size >= BROAD_SCAN_PACKAGES) {
    return { source: 'scan', reason: `matches in ${packages.size} packages` };
  }
  if (likely.length >= BROAD_SCAN_FILES) {
    return { source: 'scan', reason: `matches in ${likely.length} files` };
  }
  return null;
}

export function complexByJev(jev: JevSize | null | undefined): ComplexSignal | null {
  const confidence = jev?.routeConfidence ?? null;
  if (jev?.tier !== 'top' || confidence === null || confidence < COMPLEX_JEV_AT) return null;
  return { source: 'jev', reason: `Jev top tier ${confidence.toFixed(2)}` };
}

const BROAD_WORDING =
  /\b(?:refactor\w*|restructur\w*|re-?architect\w*|rework\w*|redesign\w*|overhaul\w*|rewrite|(?:new )?features?|implement\w*|add support for|end[- ]to[- ]end)\b/i;

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+\S/gm;

const STEP_VERB =
  /\b(?:add|build|create|implement|fix|write|refactor|remove|move|update|change|replace|migrate|convert|extract|split|wire|rename)\b/gi;

const MULTI_PART_ITEMS = 2;
const MULTI_PART_STEPS = 3;

function multiPart(request: string): boolean {
  return (
    (request.match(LIST_ITEM)?.length ?? 0) >= MULTI_PART_ITEMS ||
    (request.match(STEP_VERB)?.length ?? 0) >= MULTI_PART_STEPS
  );
}

const BIG_ITEMS = 3;
const BIG_STEPS = 4;
const LISTED_TARGETS = 4;
const FILE_LIST_TARGETS = 3;
const MANY_FILES = 3;
const ALSO_TARGETS = 4;
const ALSO_LENGTH = 150;

const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\([^()\n]*\)|\{[^{}\n]*\}|\[[^[\]\n]*\]/g;
const SENTENCE_BREAK = /[.!?]+(?=\s|$)|\n/;
const CLAUSE_BREAK = /[,;:]|\band also\b|\bas well as\b/i;
const ALSO = /\balso\b|\bas well as\b/i;
const WORD = /[\p{L}\p{N}]+/gu;

const CHANGE_TARGET =
  /\b(?:add|build|create|implement|fix|write|refactor|remove|move|update|change|replace|migrate|convert|extract|split|wire|rename|document|cover|show|keep|parse|print|tests?|docs?|readme|section|text|messages?|errors?|help|subcommands?|commands?|endpoints?|pages?|buttons?|columns?|tables?|fields?|flags?|options?|filters?|parsing|cli|api|schema|components?|screens?|routes?|handlers?|scripts?)\b/i;

function isTarget(clause: string): boolean {
  if ((clause.match(WORD)?.length ?? 0) < 2) return false;
  return CHANGE_TARGET.test(clause) || namedFiles([clause]).length > 0;
}

function targetsIn(sentence: string): number {
  return sentence.split(CLAUSE_BREAK).filter(isTarget).length;
}

function bigProse(request: string): boolean {
  const prose = request.replace(CODE, ' ');
  const perSentence = prose.split(SENTENCE_BREAK).map(targetsIn);
  const listed = Math.max(0, ...perSentence);
  if (listed >= LISTED_TARGETS) return true;
  if (listed >= FILE_LIST_TARGETS && namedFiles([prose]).length >= MANY_FILES) return true;
  const targets = perSentence.reduce((sum, count) => sum + count, 0);
  return ALSO.test(prose) && targets >= ALSO_TARGETS && prose.length >= ALSO_LENGTH;
}

export function bigByRule(request: string): string | null {
  if (complexByRule(request) === 'multi-package') return 'several packages';
  const items = request.match(LIST_ITEM)?.length ?? 0;
  const steps = request.match(STEP_VERB)?.length ?? 0;
  if (items >= BIG_ITEMS || steps >= BIG_STEPS || bigProse(request)) return 'several parts';
  return null;
}

const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+\S/;
const INLINE_CODE = /`[^`\n]+`/;
const SPEC_ITEM_SHARE = 2 / 3;

function namesCode(item: string): boolean {
  return INLINE_CODE.test(item) || namedFiles([item]).length > 0;
}

export function specByRule(request: string): string | null {
  const items = request.split('\n').filter((line) => LIST_LINE.test(line));
  if (items.length < MULTI_PART_ITEMS) return null;
  if (request.replace(CODE, ' ').includes('?')) return null;
  const concrete = items.filter(namesCode).length;
  const needed = items.length < BIG_ITEMS ? items.length : items.length * SPEC_ITEM_SHARE;
  if (concrete < needed) return null;
  return `${concrete} of ${items.length} listed parts name files or code`;
}

export function broadRequest(
  request: string | undefined,
  jev: JevSize | null | undefined,
): string | null {
  if ((jev?.complexity ?? 0) >= COMPLEX_JEV_AT) return 'Jev complexity high';
  if (complexByJev(jev)) return 'Jev top tier';
  if (!request) return null;
  if (BROAD_WORDING.test(request)) return 'broad wording';
  if (multiPart(request)) return 'several parts';
  return null;
}

export function smallByRequest(
  request: string | undefined,
  jev: JevSize | null | undefined,
): string | null {
  if (request && trivialByRule(request)) return 'one-line fix';
  const confidence = jev?.routeConfidence ?? null;
  if (jev?.tier === 'small' && confidence !== null && confidence >= SMALL_JEV_AT) {
    return `Jev small tier ${confidence.toFixed(2)}`;
  }
  return null;
}

export interface Breadth {
  complex: ComplexSignal | null;
  setAside: string | null;
}

export function complexByBreadth(
  report: ScanReport | null | undefined,
  request: string | undefined,
  jev: JevSize | null | undefined,
): Breadth {
  const scan = complexByScan(report);
  if (!scan) return { complex: null, setAside: null };
  const small = smallByRequest(request, jev);
  if (small) return { complex: null, setAside: `${scan.reason} set aside: ${small}` };
  const broad = broadRequest(request, jev);
  if (!broad) return { complex: null, setAside: null };
  return { complex: { source: 'scan', reason: `${scan.reason}, ${broad}` }, setAside: null };
}

export function firstSignal(
  ...signals: readonly (ComplexSignal | null | undefined)[]
): ComplexSignal | null {
  return signals.find((signal): signal is ComplexSignal => Boolean(signal)) ?? null;
}
