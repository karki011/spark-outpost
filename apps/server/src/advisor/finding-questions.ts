import { redactText } from '../audit/redact.ts';
import type { IntakeQuestions, SystemOneResponse } from './intake-questions.ts';
import { validNoul } from './intake-questions.ts';
import { ACT_AT } from './policy.ts';
import { capped, MAX_DIFF_CHARACTERS, MAX_REQUEST_CHARACTERS, noulQuestion } from './questions.ts';

export const FINDING_QUESTION = 'Is this finding a concrete correctness bug in the change?';
export const MAX_FINDING_CHARACTERS = 500;

const NIT_LABEL =
  /^\W*(?:nit(?:pick)?|style|naming|minor|optional|suggestion|cosmetic|consider|praise|fyi)\b/i;

const BUG_WORDS =
  /\b(?:bugs?|buggy|incorrect(?:ly)?|wrong(?:ly)?|regression|regresses|crash(?:es|ed)?|broken|breaks|off[- ]by[- ]one|race condition|data loss|corrupts?)\b/i;

const BEHAVIOR_WORDS =
  /\b(?:accept(?:s|ed)?|reject(?:s|ed)?|returns?|returned|throws?|thrown|fails?|failing|failed|exceptions?|missing|missed|misses|omits?|omitted|incomplete|unhandled|not handled|not implemented|unimplemented|ignores?|ignored|drops?|dropped|loses?|lost|differs?|instead of|edge case|critical|no tests? (?:covers?|for)|(?:does not|doesn't|never|no longer) (?:handle|check|reject|throw|validate|cover|work|match|update|call|return|compile)|should (?:throw|reject|return|fail|handle|not|be rejected))\b|→|->/i;

const STYLE_WORDS =
  /\b(?:nam(?:e|es|ed|ing)|renam\w*|style|stylistic|format\w*|whitespace|indent\w*|typos?|comments?|docstrings?|jsdoc|readab\w*|cosmetic|consisten\w*|lint\w*|prefer\w*|simplif\w*|refactor\w*|duplicat\w*|verbose|nit\w*|cleaner|tidy|tidier)\b/i;

const HARDENING_WORDS =
  /\b(?:formulas?|formula injection|csv injection|spreadsheets?|some (?:\w+ )?(?:readers?|browsers?|clients?|parsers?|tools?|environments?|platforms?|versions?|programs?|apps?)|may (?:lose|fail|break|not|become|leak|cause|corrupt)|could (?:potentially )?(?:lead|allow|cause|leak)|in (?:some|rare) cases|hardening|harden\w*|defen[cs]ive\w*|defen[cs]e in depth|robust\w*|safety concerns?|to be safe|safer|revok\w*|asynchronous\w*|timing|neutrali[sz]\w*|sanitiz\w*|saniti[sz]\w*|does not guarantee|doesn't guarantee|not guaranteed|rate[- ]limit\w*|denial of service|consider(?:ing)?)\b/i;

const REQUIRED_WORDS =
  /\b(?:(?:the )?(?:request|task|plan|agreed plan|spec|story|ticket) (?:asks?|asked|requires?|required|says|said|specifies|specified|calls for|called for|lists|listed|wants)|required by the (?:request|task|plan)|(?:planned|requested|listed|required) (?:step|behaviou?r|requirement|charset|encoding|filename|format|header|field|order|case|output)|(?:omits|skips|misses|contradicts|ignores|violates) (?:the |a )?(?:planned|requested|listed|plan|request|requirement))\b/i;

const CONCRETE_WRONG =
  /→|->|\b(?:returns?|gives|yields|produces|prints|shows|renders)\b[^.;]*\b(?:instead of|when it should|but should|rather than)\b|\bshould (?:throw|return|reject|be rejected|fail)\b/i;

const REAL_VULNERABILITY =
  /\b(?:sql injection|command injection|shell injection|code injection|xss|cross[- ]site scripting|path traversal|directory traversal|remote code execution|privilege escalation|ssrf|open redirect|(?:auth(?:entication|orization)?|permission|access[- ]control) (?:bypass|checks? (?:is |are )?missing)|(?:bypass(?:es)?|skips) (?:the )?(?:auth\w*|permission checks?|access control)|(?:no|missing) (?:auth\w*|permission|access[- ]control) checks?|(?:leaks?|exposes?|logs?|returns?) (?:the )?(?:user's |users' )?(?:secrets?|credentials?|tokens?|passwords?|api keys?|password hashes)|(?:unescaped|not escaped|without escaping)\b[^.;]{0,40}\b(?:html|user input|markup))\b/i;

const KIND_TAG = /^\W*\[(bug|missing|hardening|style)\]/i;

export type FindingKind = 'bug' | 'suggestion' | 'style';

const TAG_KINDS: Record<string, FindingKind> = {
  bug: 'bug',
  missing: 'bug',
  hardening: 'suggestion',
  style: 'style',
};

function taggedKind(text: string): FindingKind | null {
  const tag = KIND_TAG.exec(text)?.[1]?.toLowerCase();
  return tag ? TAG_KINDS[tag]! : null;
}

export function findingKind(finding: string): FindingKind {
  const text = finding.trim();
  const tagged = taggedKind(text);
  if (tagged) return tagged;
  if (!text || NIT_LABEL.test(text)) return 'style';
  if (REAL_VULNERABILITY.test(text)) return 'bug';
  if (HARDENING_WORDS.test(text) && !REQUIRED_WORDS.test(text) && !CONCRETE_WRONG.test(text)) {
    return 'suggestion';
  }
  if (BUG_WORDS.test(text)) return 'bug';
  if (REQUIRED_WORDS.test(text)) return 'bug';
  return BEHAVIOR_WORDS.test(text) && !STYLE_WORDS.test(text) ? 'bug' : 'style';
}

export function isCorrectnessFinding(finding: string): boolean {
  return findingKind(finding) === 'bug';
}

export const findingKey = (index: number) => `finding_${index + 1}`;

export interface FindingFacts {
  request: string;
  diff: string;
  findings: readonly string[];
  plan?: string | null;
}

export function buildFindingQuestions(facts: FindingFacts): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {};
  facts.findings.forEach((finding, index) => {
    questions[findingKey(index)] = noulQuestion(
      {
        question: FINDING_QUESTION,
        finding: capped(redactText(finding), MAX_FINDING_CHARACTERS),
        how: 'Yes only when the finding names behavior of `diff` that is wrong for `task` (or `plan`, when given): a bug, a wrong or failing result, a crash, or a requirement of `task` or `plan` the change misses. A finding that names an input and the wrong output it gives is a strong sign. No for hardening, security or robustness advice that `task` and `plan` do not ask for, such as neutralizing spreadsheet formulas in an export, quoting for some other reader, or cleanup timing, unless the change itself adds an exploitable hole such as SQL injection or an auth bypass.',
      },
      {
        true: 'A concrete correctness problem against the task or plan: wrong or failing behavior, a missed requirement, or a real vulnerability the change adds',
        false:
          'Style, naming, readability, structure, a hardening or robustness suggestion the task did not ask for, a question, or praise',
      },
    );
  });
  const plan = facts.plan?.trim();
  return {
    state: {
      task: capped(redactText(facts.request), MAX_REQUEST_CHARACTERS),
      ...(plan ? { plan: capped(redactText(plan), MAX_REQUEST_CHARACTERS) } : {}),
      diff: capped(redactText(facts.diff), MAX_DIFF_CHARACTERS),
    },
    questions,
  };
}

export interface FindingReading {
  finding: string;
  rules: boolean;
  kind: FindingKind;
  noul: number | null;
  correct: boolean;
  by: 'jev' | 'rules';
}

function jevSays(noul: number | null): boolean | null {
  if (noul === null) return null;
  if (noul >= ACT_AT.finding) return true;
  if (1 - noul >= ACT_AT.finding) return false;
  return null;
}

function jevMayPromote(finding: string, kind: FindingKind, checksPass: boolean): boolean {
  return kind === 'style' && !checksPass && taggedKind(finding.trim()) === null;
}

export function readFindings(
  findings: readonly string[],
  response: SystemOneResponse | null,
  { checksPass = false }: { checksPass?: boolean } = {},
): FindingReading[] {
  return findings.map((finding, index) => {
    const kind = findingKind(finding);
    const rules = kind === 'bug';
    const noul = validNoul(response, findingKey(index));
    const said = jevSays(noul);
    const ignored = said === true && !rules && !jevMayPromote(finding, kind, checksPass);
    const jev = ignored ? null : said;
    return {
      finding,
      rules,
      kind,
      noul,
      correct: jev ?? rules,
      by: jev === null ? 'rules' : 'jev',
    };
  });
}
