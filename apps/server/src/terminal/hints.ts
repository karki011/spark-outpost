import type { TerminalHint } from '@spark-outpost/contracts';
import type { CatalogEntry } from '../providers/catalog.ts';

export interface DetectedHint {
  hint: TerminalHint;
  nextCommand: string | null;
}

interface HintRule {
  id: string;
  pattern: RegExp;
  message: (entry: CatalogEntry) => string;
  nextCommand?: (entry: CatalogEntry) => string;
  checkAgain?: boolean;
}

export function allowScriptsCommand(entry: CatalogEntry): string {
  return `npm install -g --allow-scripts=${entry.packageName} ${entry.packageName}`;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b[()][A-Z0-9]/g;

const rules: HintRule[] = [
  {
    id: 'npm_missing',
    pattern: /command not found: npm|npm: command not found/g,
    message: () =>
      "npm isn't installed. Install Node.js 18 or newer from nodejs.org, open a new terminal, then run the command again.",
  },
  {
    id: 'npm_permissions',
    pattern: /EACCES/g,
    message: () =>
      "npm can't write to its global folder. Avoid sudo: run `npm config set prefix ~/.npm-global`, add `~/.npm-global/bin` to your PATH, then run the install again.",
  },
  {
    id: 'installed',
    pattern: /(added|changed) \d+ packages?/g,
    message: (entry) => `Installed \`${entry.cli}\`. Checking whether you're logged in.`,
    checkAgain: true,
  },
  {
    id: 'install_scripts_blocked',
    pattern: /install-scripts[^\n]*(not yet covered by allowScripts|--allow-scripts)/g,
    message: (entry) =>
      `npm skipped the package's setup script, so \`${entry.cli}\` may not work yet. Run \`${allowScriptsCommand(entry)}\` to finish the install.`,
    nextCommand: allowScriptsCommand,
  },
  {
    id: 'logged_in',
    pattern: /Login successful|Successfully logged in|Logged in (as|using)/gi,
    message: () => "You're logged in. Checking again to finish connecting.",
    checkAgain: true,
  },
  {
    id: 'cli_not_found',
    pattern: /command not found: (claude|codex)|(claude|codex): command not found/g,
    message: (entry) =>
      `Your shell can't find \`${entry.cli}\` yet. Open a new terminal, or add npm's global bin folder (\`npm prefix -g\` + \`/bin\`) to your PATH.`,
  },
];

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function matchIndexes(pattern: RegExp, text: string): number[] {
  return [...text.matchAll(pattern)].map((match) => match.index);
}

export function detectHint(entry: CatalogEntry, output: string): DetectedHint | null {
  const text = stripAnsi(output);
  let best: { rule: HintRule; index: number } | null = null;
  for (const rule of rules) {
    const index = matchIndexes(rule.pattern, text).at(-1) ?? -1;
    if (index >= 0 && (!best || index > best.index)) best = { rule, index };
  }
  if (!best) return null;
  if (best.rule.id === 'installed') {
    const blocked = rules.find((rule) => rule.id === 'install_scripts_blocked')!;
    if (matchIndexes(blocked.pattern, text).length > 0) best = { rule: blocked, index: best.index };
  }
  return {
    hint: {
      id: best.rule.id,
      message: best.rule.message(entry),
      checkAgain: best.rule.checkAgain ?? false,
    },
    nextCommand: best.rule.nextCommand?.(entry) ?? null,
  };
}
