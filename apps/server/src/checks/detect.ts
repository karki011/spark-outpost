import type { CheckKind } from '@spark-outpost/contracts';

export interface CheckCommand {
  kind: CheckKind;
  command: string;
  argv: string[];
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

export const CONFIG_FILES = [
  'package.json',
  'pyproject.toml',
  'pytest.ini',
  'Cargo.toml',
  'go.mod',
  ...LOCKFILES.map(([file]) => file),
];

export const LOCKFILE_NAMES = LOCKFILES.map(([file]) => file);

export const TOOL_FILES = ['nx.json', 'turbo.json', 'pnpm-workspace.yaml', '.yarnrc.yml'];

const MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

export function declaredManager(packageJson: string | null): PackageManager | null {
  if (!packageJson) return null;
  try {
    const declared = (JSON.parse(packageJson) as { packageManager?: unknown }).packageManager;
    if (typeof declared !== 'string') return null;
    const name = declared.split('@')[0];
    return MANAGERS.find((manager) => manager === name) ?? null;
  } catch {
    return null;
  }
}

export function packageManager(
  present: ReadonlySet<string>,
  packageJson: string | null = null,
): PackageManager {
  return (
    declaredManager(packageJson) ?? LOCKFILES.find(([file]) => present.has(file))?.[1] ?? 'npm'
  );
}
