import path from 'node:path';

const ENTRIES = {
  api: 'src/api/main.ts',
  worker: 'src/workflow/main.ts',
  migrate: 'src/persistence/migrate-cli.ts',
} as const;

interface BundledLayout {
  bootstrap: string;
  serverDir: string | null;
}

export function serverEntry(serverDir: string, name: keyof typeof ENTRIES): string {
  return path.join(serverDir, ENTRIES[name]);
}

export function isBundledService(
  service: { bootstrap: string; entry: string; cwd: string },
  layout: BundledLayout,
): boolean {
  const { serverDir } = layout;
  if (serverDir === null) return false;
  if (!path.isAbsolute(service.entry)) return false;
  if (path.resolve(service.bootstrap) !== path.resolve(layout.bootstrap)) return false;
  if (path.resolve(service.cwd) !== path.resolve(serverDir)) return false;
  const entry = path.resolve(service.entry);
  return Object.values(ENTRIES).some((allowed) => path.join(serverDir, allowed) === entry);
}
