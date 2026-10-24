import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');

const TEST_RULES = path.join(tmpdir(), `spark-outpost-test-rules-${process.pid}`);
const env = {
  SPARK_RULES_FILE: path.join(TEST_RULES, 'settings.json'),
  SPARK_MANAGED_RULES_FILE: path.join(TEST_RULES, 'managed-settings.json'),
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          env,
          setupFiles: ['apps/server/test/recommended-rules-setup.ts'],
          include: ['{apps,packages,scripts,infra}/**/*.test.{ts,tsx}'],
          exclude: [
            '**/*.db.test.ts',
            '**/*.live.test.ts',
            '**/node_modules/**',
            'apps/desktop/release/**',
            'tests/browser/**',
            'scripts/bench/fixture/**',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          env,
          include: ['{apps/server,apps/desktop/src,scripts}/**/*.db.test.ts'],
          setupFiles: ['apps/server/test/worker-database.ts'],
          environment: 'node',
          maxWorkers: 8,
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'live',
          env,
          include: ['apps/server/**/*.live.test.ts'],
          environment: 'node',
          testTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
