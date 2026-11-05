import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  fakeTailscaleCommand,
  fakeTailscaleState,
  type FakeTailscaleState,
} from '../../../apps/server/test/fake-tailscale.ts';

const file = process.env.FAKE_TAILSCALE_STATE;
if (!file) {
  process.stderr.write('FAKE_TAILSCALE_STATE is not set\n');
  process.exit(2);
}

const saved: Partial<FakeTailscaleState> = existsSync(file)
  ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<FakeTailscaleState>)
  : {};
const state = fakeTailscaleState({ ...saved, calls: [] });
const result = fakeTailscaleCommand(state, process.argv.slice(2));
writeFileSync(file, JSON.stringify({ ...state, calls: [] }));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.code);
