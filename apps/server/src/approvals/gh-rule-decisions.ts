import type { ModePosture } from '@spark-outpost/contracts';
import type { ApprovalRequest, DecideOptions, Decision } from './decide.ts';
import { followsAny, ghRuling, NO_GH_RULES } from './gh-rules.ts';
import { modeAllows } from './mode-allows.ts';

export function sparkRuleRefusal(
  request: ApprovalRequest,
  options: DecideOptions,
): Decision | null {
  if (!options.changesProject || !request.command) return null;
  const ruling = ghRuling(request.command, options.ghRules ?? NO_GH_RULES);
  if (ruling.kind !== 'refused') return null;
  return { verdict: 'reject', reason: ruling.reason, sparkRule: ruling.rule };
}

export function followsAtOnce(
  posture: ModePosture,
  request: ApprovalRequest,
  options: DecideOptions,
): boolean {
  if (!options.changesProject || !request.command || !modeAllows(posture, request)) return false;
  return ghRuling(request.command, options.ghRules ?? NO_GH_RULES).kind === 'follows';
}

export function askedForRule(
  posture: ModePosture,
  request: ApprovalRequest,
  options: DecideOptions,
): boolean {
  if (modeAllows(posture, request) || !request.command) return false;
  return followsAny(request.command, options.ghRules ?? NO_GH_RULES);
}
