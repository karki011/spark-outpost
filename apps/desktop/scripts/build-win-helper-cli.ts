import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildWinHelper, testWinHelper } from './win-helper-bundle.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: 'x64' },
    test: { type: 'boolean', default: false },
  },
});

if (values.arch !== 'x64') throw new Error(`Unknown --arch ${values.arch}; only x64 for now.`);

try {
  if (values.test) {
    await testWinHelper(repoRoot);
    console.log('Windows helper tests passed.');
  }
  console.log(`Windows helper for x64: ${await buildWinHelper(repoRoot, 'x64')}`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
