import { describe, expect, it } from 'vitest';
import { configuredBackup } from '../src/persistence/startup-backup.ts';

describe('configuredBackup', () => {
  it('takes no backup when BACKUP_DIR is not set', () => {
    expect(
      configuredBackup({ DATABASE_URL: 'postgres://localhost/spark_outpost' }),
    ).toBeUndefined();
  });

  it('backs up into BACKUP_DIR when it is set', () => {
    const backup = configuredBackup({
      DATABASE_URL: 'postgres://localhost/spark_outpost',
      BACKUP_DIR: '/tmp/spark-backups',
    });
    expect(backup).toBeTypeOf('function');
  });

  it.each(['spark_outpost_test', 'spark_outpost_test_wstab', 'spark_outpost_test_wstab_w3'])(
    'never backs up the %s test database',
    (name) => {
      expect(
        configuredBackup({
          DATABASE_URL: `postgres://localhost/${name}`,
          BACKUP_DIR: '/tmp/spark-backups',
        }),
      ).toBeUndefined();
    },
  );
});
