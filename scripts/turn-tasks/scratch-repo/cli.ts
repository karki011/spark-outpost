import { parseArgs } from 'node:util';
import { scratchBase } from '../paths.ts';
import { freshCopy, removeCopy } from './create.ts';

const { values } = parseArgs({
  options: {
    name: { type: 'string', default: `manual-${Date.now()}` },
    base: { type: 'string', default: scratchBase() },
    remove: { type: 'boolean', default: false },
  },
});

const repo = await freshCopy(values.name, values.base);
console.log(`Scratch repository: ${repo.path}`);
console.log(`Starting commit: ${repo.commit}`);
if (values.remove) {
  await removeCopy(repo);
  console.log('Removed.');
}
