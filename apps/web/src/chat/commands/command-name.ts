const SUBCOMMANDS: Readonly<Record<string, number>> = {
  gh: 2,
  git: 1,
  pnpm: 1,
  npm: 1,
  yarn: 1,
  bun: 1,
  cargo: 1,
  go: 1,
  docker: 1,
  kubectl: 1,
};

const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SEPARATORS = /&&|\|\||[;|\n]/;

function firstStep(command: string): string {
  const steps = command.split(SEPARATORS).map((step) => step.trim());
  return steps.find((step) => step !== '' && step !== 'cd' && !step.startsWith('cd ')) ?? '';
}

function unquoted(word: string): string {
  return word.replace(/^["']|["']$/g, '');
}

export function commandName(command: string): string {
  const whole = command.trim();
  const words = firstStep(whole).split(/\s+/).filter(Boolean);
  let at = 0;
  while (at < words.length && (ASSIGNMENT.test(words[at]!) || WRAPPERS.has(words[at]!))) at += 1;
  const program = unquoted(words[at] ?? '')
    .split('/')
    .at(-1);
  if (!program) return whole;
  const parts = [program];
  for (const word of words.slice(at + 1, at + 1 + (SUBCOMMANDS[program] ?? 0))) {
    if (word.startsWith('-')) break;
    parts.push(word);
  }
  const name = parts.join(' ');
  return name === whole ? name : `${name}…`;
}
