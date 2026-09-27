import type { Db } from './db.ts';
import { MigrationError, runMigrations } from './migrate.ts';

export interface StartupMigrationOptions {
  backup: () => Promise<string>;
  dir?: string;
}

export interface StartupMigrationResult {
  applied: string[];
  backupPath: string | null;
}

function backupNote(backupPath: string | null): string {
  return backupPath
    ? `The backup taken before migrating is at ${backupPath}.`
    : 'No backup was taken because the database was empty.';
}

export async function migrateAtStartup(
  db: Db,
  options: StartupMigrationOptions,
): Promise<StartupMigrationResult> {
  let backupPath: string | null = null;
  const beforeUpgrade = async (pending: string[]) => {
    try {
      backupPath = await options.backup();
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
    throw new Error(`${error.message}. ${backupNote(backupPath)}`, { cause: error });
  }
}

export async function migrateOrExit(db: Db, options: StartupMigrationOptions): Promise<void> {
  try {
    const { applied, backupPath } = await migrateAtStartup(db, options);
    if (applied.length === 0) return;
    console.log(`Applied migrations: ${applied.join(', ')}. ${backupNote(backupPath)}`);
  } catch (error) {
    console.error((error as Error).message);
    await db.end();
    process.exit(1);
  }
}
