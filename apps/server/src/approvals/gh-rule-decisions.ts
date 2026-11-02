import type { ModePosture } from '@spark-outpost/contracts';
import type { ApprovalRequest, DecideOptions, Decision } from './decide.ts';
import { followsAny, ghRuling, DEFAULT_RULE_CONTEXT, type GhRuling } from './gh-rules.ts';
import { modeAllows } from './mode-allows.ts';

function rulingOf(request: ApprovalRequest, options: DecideOptions): GhRuling | null {
  if (!options.changesProject || !request.command) return null;
  return ghRuling(request.command, options.sparkRules ?? DEFAULT_RULE_CONTEXT);
}

export function sparkRuleRefusal(
  request: ApprovalRequest,
  options: DecideOptions,
): Decision | null {
  const ruling = rulingOf(request, options);
  if (ruling?.kind !== 'refused') return null;
  const card = ruling.rule ? { sparkRule: ruling.rule } : {};
  return { verdict: 'reject', reason: ruling.reason, rule: ruling.ruleId, ...card };
}

export function sparkRuleAsk(request: ApprovalRequest, options: DecideOptions): Decision | null {
  const ruling = rulingOf(request, options);
  if (ruling?.kind !== 'asks') return null;
  return { verdict: 'ask', reason: ruling.reason, rule: ruling.ruleId };
}

export function followsAtOnce(
  posture: ModePosture,
  request: ApprovalRequest,
  options: DecideOptions,
): boolean {
  if (!modeAllows(posture, request)) return false;
  return rulingOf(request, options)?.kind === 'follows';
}

export function askedForRule(
  posture: ModePosture,
  request: ApprovalRequest,
  options: DecideOptions,
): boolean {
  if (modeAllows(posture, request) || !request.command) return false;
  return followsAny(request.command, options.sparkRules ?? DEFAULT_RULE_CONTEXT);
}
