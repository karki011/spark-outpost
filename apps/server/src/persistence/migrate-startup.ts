import type { Db } from './db.ts';
import { MigrationError, runMigrations } from './migrate.ts';

export interface StartupMigrationOptions {
  backup?: (() => Promise<string>) | undefined;
  dir?: string;
}

export interface StartupMigrationResult {
  applied: string[];
  backupPath: string | null;
}

function backupNote(backupPath: string | null, enabled: boolean): string {
  if (backupPath) return `The backup taken before migrating is at ${backupPath}.`;
  return enabled
    ? 'No backup was taken because the database was empty.'
    : 'No backup was taken because BACKUP_DIR is not set.';
}

export async function migrateAtStartup(
  db: Db,
  options: StartupMigrationOptions,
): Promise<StartupMigrationResult> {
  let backupPath: string | null = null;
  const { backup } = options;
  const beforeUpgrade = async (pending: string[]) => {
    if (!backup) return;
    try {
      backupPath = await backup();
    } catch (error) {
      throw new Error(
        `Could not back up the database before applying ${pending.join(', ')}; no migrations were applied. ${(error as Error).message}`,
        { cause: error },
      );
    }
  };
  try {
    const applied = await runMigrations(db, {
      beforeUpgrade,
      ...(options.dir ? { dir: options.dir } : {}),
    });
    return { applied, backupPath };
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    throw new Error(`${error.message}. ${backupNote(backupPath, Boolean(backup))}`, {
      cause: error,
    });
  }
}

export async function migrateOrExit(db: Db, options: StartupMigrationOptions): Promise<void> {
  try {
    const { applied, backupPath } = await migrateAtStartup(db, options);
    if (applied.length === 0) return;
    console.log(
      `Applied migrations: ${applied.join(', ')}. ${backupNote(backupPath, Boolean(options.backup))}`,
    );
  } catch (error) {
    console.error((error as Error).message);
    await db.end();
    process.exit(1);
  }
}
