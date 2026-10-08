import { redirectTargets } from '../../../apps/server/src/coordinator/edit-evidence.ts';

for (const command of process.argv.slice(2))
  console.log(JSON.stringify(await redirectTargets(command)), command);
