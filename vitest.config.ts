import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
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
          include: ['apps/server/**/*.live.test.ts'],
          environment: 'node',
          testTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
