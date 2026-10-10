import { record, secondsFlag, sleep, token } from './run-state.mjs';

const seconds = secondsFlag(90);
const startedAt = new Date().toISOString();

for (let second = 1; second <= seconds; second += 1) {
  await sleep(1000);
  console.log(`tick ${second} of ${seconds}`);
}

const lastLine = `ticker finished ${seconds}/${seconds} token ${token()}`;
await record('ticker.json', { seconds, startedAt, finishedAt: new Date().toISOString(), lastLine });
console.log(lastLine);
