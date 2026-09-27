import type { JevIntake, MechanicalNote, Risk, RunMode } from '@spark-outpost/contracts';
import { noulVerdict } from './parallel-choice.ts';

const MECHANICAL_VERB =
  /\b(?:rename[sd]?|renaming|move[sd]?|moving|(?:fix|clear|resolve)(?:es|ed|ing)?\s+(?:(?:the|all|every|these|any)\s+)?(?:type(?:script)?[- ]?(?:check\s+)?errors?|tsc\s+errors?|lint(?:ing)?\s+(?:errors?|warnings?|issues?)|eslint\s+(?:errors?|warnings?))|lint[- ]fix|eslint\s+--fix)\b/i;
const NEW_WORK =
  /(?<!#)\b(?:add|build|create|implement|write|design|introduce|support|delete|remove|drop|migrate)\b/i;
const SYMBOL =
  /`[^`\s]+`|\b[a-z]+[A-Z]\w*\b|\b[A-Z][a-z0-9]+[A-Z]\w*\b|\b[A-Za-z_]\w*\.[A-Za-z_]\w*\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;

export interface MechanicalCall {
  mechanical: boolean;
  source: 'jev' | 'rules';
  jev: number | null;
  rule: boolean;
}

export function mechanicalByRule(request: string, namedFiles: number): boolean {
  if (!MECHANICAL_VERB.test(request) || NEW_WORK.test(request)) return false;
  return namedFiles > 0 || SYMBOL.test(request);
}

export function mechanicalChange(
  mode: RunMode,
  risk: Risk,
  request: string,
  namedFiles: number,
  jev: JevIntake | null,
): MechanicalCall | null {
  if (mode !== 'do' || risk !== 'multi-file') return null;
  const rule = mechanicalByRule(request, namedFiles);
  const answered = jev?.mechanical ?? null;
  const asked = answered === null ? null : noulVerdict(answered).value;
  if (asked === null) return { mechanical: rule, source: 'rules', jev: answered, rule };
  return { mechanical: asked, source: 'jev', jev: answered, rule };
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function worthRecording(call: MechanicalCall | null): call is MechanicalCall {
  return call !== null && (call.jev !== null || call.rule);
}

export function mechanicalSummary(call: MechanicalCall): string {
  const jev = call.jev === null ? 'Jev did not answer' : `Jev ${call.jev.toFixed(2)}`;
  return `mechanical ${yesNo(call.mechanical)} (${call.source}; ${jev}; rule: ${yesNo(call.rule)})`;
}

export function mechanicalNote(call: MechanicalCall): MechanicalNote {
  return { ...call, summary: mechanicalSummary(call) };
}

export const MECHANICAL_REASON =
  'The change applies one clear pattern across files, so one Builder does it without an Architect.';
