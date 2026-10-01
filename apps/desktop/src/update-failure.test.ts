import { describe, expect, it } from 'vitest';
import { failureDialog, previousVersionInstructions } from './update-failure.ts';

const context = {
  appName: 'Spark Outpost',
  version: '0.3.0',
  arch: 'arm64',
  feedUrl: 'https://updates.example.com/spark',
  userData: '/Users/me/Library/Application Support/Spark Outpost',
};

const restored = {
  status: 'restored' as const,
  detail: 'Migration 0090_x.sql failed: boom',
  backup: { kind: 'copy' as const, path: '/data/backups/update-2026' },
  previousVersion: '0.2.0',
};

describe('migration failure help', () => {
  it('says the data is back and how to reinstall the previous version', () => {
    const text = previousVersionInstructions(restored, context);
    expect(text).toContain('Your data was restored from that backup');
    expect(text).toContain('/data/backups/update-2026');
    expect(text).toContain('https://updates.example.com/spark/Spark-Outpost-0.2.0-arm64.dmg');
    expect(text).toContain('It skips 0.3.0');
    expect(text).toContain('Migration 0090_x.sql failed: boom');
    expect(failureDialog(restored, context).message).toBe(
      "Spark Outpost 0.3.0 couldn't update your data.",
    );
    expect(failureDialog(restored, context).detail).toContain('Nothing was lost');
  });

  it('warns not to delete anything when the restore did not finish', () => {
    const unrestored = { ...restored, status: 'unrestored' as const };
    expect(failureDialog(unrestored, context).detail).toContain("Don't delete anything");
    expect(previousVersionInstructions(unrestored, { ...context, feedUrl: null })).toContain(
      'the download page or the copy you installed it from',
    );
  });
});
