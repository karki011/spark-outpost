import { redactText } from '../audit/redact.ts';
import type { IntakeQuestions, SystemOneResponse } from './intake-questions.ts';
import { validNoul } from './intake-questions.ts';
import { capped, MAX_DIFF_CHARACTERS, MAX_REQUEST_CHARACTERS } from './policy-gate.ts';
import { ACT_AT } from './policy.ts';
import { noulQuestion } from './questions.ts';

export const FINDING_QUESTION = 'Is this finding a concrete correctness bug in the change?';
export const MAX_FINDING_CHARACTERS = 500;

const NIT_LABEL =
  /^\W*(?:nit(?:pick)?|style|naming|minor|optional|suggestion|cosmetic|consider|praise|fyi)\b/i;

const BUG_WORDS =
  /\b(?:bugs?|buggy|incorrect(?:ly)?|wrong(?:ly)?|regression|regresses|crash(?:es|ed)?|broken|breaks|off[- ]by[- ]one|security|vulnerab\w*|race condition|data loss|corrupts?)\b/i;

const BEHAVIOR_WORDS =
  /\b(?:accept(?:s|ed)?|reject(?:s|ed)?|returns?|returned|throws?|thrown|fails?|failing|failed|exceptions?|missing|missed|misses|unhandled|not handled|not implemented|unimplemented|ignores?|ignored|drops?|dropped|loses?|lost|differs?|instead of|edge case|critical|no tests? (?:covers?|for)|(?:does not|doesn't|never|no longer) (?:handle|check|reject|throw|validate|cover|work|match|update|call|return|compile)|should (?:throw|reject|return|fail|handle|not|be rejected))\b|→|->/i;

const STYLE_WORDS =
  /\b(?:nam(?:e|es|ed|ing)|renam\w*|style|stylistic|format\w*|whitespace|indent\w*|typos?|comments?|docstrings?|jsdoc|readab\w*|cosmetic|consisten\w*|lint\w*|prefer\w*|simplif\w*|refactor\w*|duplicat\w*|verbose|nit\w*|cleaner|tidy|tidier)\b/i;

export function isCorrectnessFinding(finding: string): boolean {
  const text = finding.trim();
  if (!text || NIT_LABEL.test(text)) return false;
  if (BUG_WORDS.test(text)) return true;
  return BEHAVIOR_WORDS.test(text) && !STYLE_WORDS.test(text);
}

export const findingKey = (index: number) => `finding_${index + 1}`;

export interface FindingFacts {
  request: string;
  diff: string;
  findings: readonly string[];
}

export function buildFindingQuestions(facts: FindingFacts): IntakeQuestions {
  const questions: IntakeQuestions['questions'] = {};
  facts.findings.forEach((finding, index) => {
    questions[findingKey(index)] = noulQuestion(
      {
        question: FINDING_QUESTION,
        finding: capped(redactText(finding), MAX_FINDING_CHARACTERS),
        how: 'Yes only when the finding names behavior of `diff` that is wrong for `task`: a bug, a wrong or failing result, a crash, or a requirement of `task` the change misses. A finding that names an input and the wrong output it gives is a strong sign.',
      },
      {
        true: 'A concrete correctness problem: wrong or failing behavior, or a missed requirement',
        false: 'Style, naming, readability, structure, a suggestion, a question, or praise',
      },
    );
  });
  return {
    state: {
      task: capped(redactText(facts.request), MAX_REQUEST_CHARACTERS),
      diff: capped(redactText(facts.diff), MAX_DIFF_CHARACTERS),
    },
    questions,
  };
}

export interface FindingReading {
  finding: string;
  rules: boolean;
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

export function readFindings(
  findings: readonly string[],
  response: SystemOneResponse | null,
): FindingReading[] {
  return findings.map((finding, index) => {
    const rules = isCorrectnessFinding(finding);
    const noul = validNoul(response, findingKey(index));
    const jev = jevSays(noul);
    return { finding, rules, noul, correct: jev ?? rules, by: jev === null ? 'rules' : 'jev' };
  });
}
