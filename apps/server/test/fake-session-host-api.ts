import { nodeLauncher } from '../src/terminal/session-host/host-launch.ts';
import { hostKept } from '../src/terminal/session-host/host-kept.ts';
import { sessionHostPaths } from '../src/terminal/session-host/paths.ts';
import type { SpawnPty } from '../src/terminal/pty.ts';

const [directory, script] = process.argv.slice(-2);
if (!directory || !script) throw new Error('Pass the host folder and the script to run.');

const refused: SpawnPty = () => {
  throw new Error('The direct PTY was used.');
};
const kept = hostKept(
  { paths: sessionHostPaths(directory), launcher: nodeLauncher() },
  () => undefined,
);
const pty = kept.spawner(refused)({
  sessionId: 's1',
  command: process.execPath,
  args: ['-e', script],
  cols: 80,
  rows: 24,
  cwd: directory,
});
let output = '';
pty.onData((data) => {
  output += data;
  if (output.includes('ready:')) process.stdout.write(`started ${pty.pid}\n`);
});
setInterval(() => undefined, 60_000);
