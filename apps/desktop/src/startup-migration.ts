import path from 'node:path';
import type { ChannelPaths } from './channel.ts';
import {
  backupName,
  copyDataDir,
  dumpDatabase,
  findDumpTools,
  restoreDataDir,
  restoreDump,
  rotateBackups,
  type Backup,
} from './data-backup.ts';
import { pendingMigrations } from './migration-status.ts';
import {
  markerFile,
  readMarker,
  skippedVersionFile,
  writeMarker,
  writeSkippedVersion,
  type MigrateOutcome,
  type MigrationGuardEffects,
} from './update-migration.ts';

export interface StartupMigrationOptions {
  paths: ChannelPaths;
  migrationsDir: string;
  toolDirs: string[];
  databaseUrl: () => string;
  stopDatabase: () => Promise<void>;
  startDatabase: () => Promise<void>;
  runMigrate: () => Promise<MigrateOutcome>;
  log: (line: string) => void;
}

export function startupMigrationEffects(options: StartupMigrationOptions): MigrationGuardEffects {
  const { paths, log } = options;
  const marker = markerFile(paths.userData);
  const failedCopy = path.join(paths.userData, 'postgres-failed-update');
  let tools: Awaited<ReturnType<typeof findDumpTools>> | undefined;
  const dumpTools = async () => (tools ??= await findDumpTools(options.toolDirs));

  const coldCopy = async (target: string): Promise<Backup> => {
    await options.stopDatabase();
    try {
      return await copyDataDir(paths.postgresData, target);
    } finally {
      await options.startDatabase();
    }
  };

  return {
    pending: () => pendingMigrations(options.databaseUrl(), options.migrationsDir),
    async backup(previousVersion) {
      const name = path.join(paths.backups, backupName(previousVersion ?? 'unknown', new Date()));
      const found = await dumpTools();
      const backup = found
        ? await dumpDatabase(found, options.databaseUrl(), `${name}.dump`)
        : await coldCopy(name);
      log(`Backed up the database before migrating (${backup.kind}): ${backup.path}`);
      return backup;
    },
    rotate: async () => {
      await rotateBackups(paths.backups);
    },
    migrate: options.runMigrate,
    async restore(backup) {
      if (backup.kind === 'dump') {
        const found = await dumpTools();
        if (!found) throw new Error('pg_restore is no longer available.');
        await restoreDump(found, options.databaseUrl(), backup.path);
      } else {
        await options.stopDatabase();
        await restoreDataDir(backup.path, paths.postgresData, failedCopy);
      }
      log(`Restored the database from ${backup.path}.`);
    },
    readMarker: () => readMarker(marker),
    writeMarker: (next) => writeMarker(marker, next),
    recordFailure: (version) => writeSkippedVersion(skippedVersionFile(paths.userData), version),
    now: () => new Date(),
  };
}
