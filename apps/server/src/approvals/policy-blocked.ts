import { normalizeCommand, programName, programTokens, splitSimpleCommands } from './commands.ts';

export const POLICY_BLOCKED = "Spark's policy blocked";

const WHOLE_COMMAND_CHARS = 40;
const COMMAND_WORDS = 3;
const BARE_WORD = /^[A-Za-z0-9][\w.:@+-]*$/;
const CHANGE_DIR = new Set(['cd', 'pushd']);

function mainCommand(command: string): string[] {
  const programs = splitSimpleCommands(command).map(programTokens);
  return programs.find((tokens) => tokens.length > 0 && !CHANGE_DIR.has(programName(tokens))) ?? [];
}

export function shortCommand(command: string): string {
  const whole = normalizeCommand(command);
  const simple = splitSimpleCommands(whole);
  if (simple.length === 1 && whole.length <= WHOLE_COMMAND_CHARS) return whole;
  const [program, ...rest] = mainCommand(whole);
  if (!program) return whole.slice(0, WHOLE_COMMAND_CHARS).trimEnd();
  const words = [programName([program])];
  for (const word of rest) {
    if (words.length >= COMMAND_WORDS || !BARE_WORD.test(word)) break;
    words.push(word);
  }
  return words.join(' ');
}

export function blockedNote(what: string, reason: string, rule?: string): string {
  return `Refused ${what} — ${rule ? `Spark rules: ${rule}` : reason}`;
}

export function policyDenial(what: string, reason: string): string {
  return `${POLICY_BLOCKED} ${what} (${reason}). This is Spark's rule, not the user's choice; don't tell the user they declined it.`;
}
