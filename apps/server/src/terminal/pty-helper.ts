import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export function ensureSpawnHelperExecutable(): void {
  const packageDir = path.dirname(require.resolve('node-pty/package.json'));
  const helper = path.join(
    packageDir,
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'spawn-helper',
  );
  if (!existsSync(helper)) return;
  try {
    accessSync(helper, constants.X_OK);
  } catch {
    chmodSync(helper, 0o755);
  }
}
