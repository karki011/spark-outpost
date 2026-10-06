import type { Category, RunMode } from '@spark-outpost/contracts';
import { planOnlyByRule, questionByRule, reviewsExistingByRule } from './risk-rules.ts';

const LEAD = "^\\s*(?:(?:please|can you|could you|would you|let'?s)\\s+)?";

const RESEARCH = new RegExp(
  `${LEAD}(?:investigate|research|look into|dig into|trace|compare|find (?:out )?(?:where|why|how|which|what)|figure out (?:where|why|how|what)|find the (?:cause|root cause))\\b`,
  'i',
);
const PLAN = new RegExp(
  `${LEAD}(?:design|plan(?: out)?)\\b|\\bplan\\b[^.\\n]{0,60}\\b(?:and|then)\\s+(?:then\\s+)?(?:build|implement|do|make|code|start)\\b`,
  'i',
);
const TESTS = new RegExp(
  `${LEAD}(?:add|write|fix|update)\\s+(?:a |an |the |some |more |missing )?(?:unit |integration |e2e |end-to-end )?tests?\\b`,
  'i',
);
const DOCS = new RegExp(
  `${LEAD}(?:document|(?:update|write|fix|improve|add)\\s+(?:to\\s+)?(?:the\\s+)?(?:readme|docs?|documentation|changelog|guide|comments?))\\b`,
  'i',
);
const CONFIG = new RegExp(
  `${LEAD}(?:configure|set up|install|upgrade|bump|(?:update|change)\\s+(?:the\\s+)?(?:deps|dependencies|ci|config|lint(?:ing)? rules|build))\\b`,
  'i',
);
const REFACTOR =
  /\b(?:refactor|restructure|rename|extract|clean up|tidy up|move [^.\n]{1,40} into)\b/i;
const FIX = /\b(?:fix|bug|broken|error|crash(?:es)?|fails?|failing|wrong|regression)\b/i;

export function researchByRule(request: string): boolean {
  return RESEARCH.test(request);
}

export function planByRule(request: string): boolean {
  return PLAN.test(request);
}

export function intentByRule(request: string, mode: RunMode): Category {
  if (researchByRule(request)) return 'research';
  if (mode !== 'do') return 'question';
  if (reviewsExistingByRule(request)) return 'review';
  if (planOnlyByRule(request) || planByRule(request)) return 'plan';
  if (questionByRule(request)) return 'question';
  if (TESTS.test(request)) return 'tests';
  if (DOCS.test(request)) return 'docs';
  if (CONFIG.test(request)) return 'config';
  if (REFACTOR.test(request)) return 'refactor';
  if (FIX.test(request)) return 'bug_fix';
  return 'feature';
}
