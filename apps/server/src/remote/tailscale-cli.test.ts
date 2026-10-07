import { describe, expect, it } from 'vitest';
import type { CommandResult, RunCommand } from '../setup/command.ts';
import { tailscaleCli } from './tailscale-cli.ts';

const STATUS = JSON.stringify({
  BackendState: 'Running',
  Self: { DNSName: 'mac.tail1234.ts.net.' },
  CertDomains: ['mac.tail1234.ts.net'],
});

function cliWith(answers: Record<string, CommandResult>) {
  const run: RunCommand = async (file, args) => {
    if (file !== '/usr/bin/env') return { code: 1, stdout: '', stderr: '' };
    if (args[0] !== 'TAILSCALE_BE_CLI=1')
      return { code: 1, stdout: '', stderr: 'The Tailscale GUI failed to start\n' };
    return answers[args.slice(2).join(' ')] ?? { code: 0, stdout: '1.80.0\n', stderr: '' };
  };
  return tailscaleCli(run, null);
}

describe('reading Tailscale', () => {
  it('asks the Tailscale app to answer as a command, since Spark has no terminal', async () => {
    const reading = await cliWith({
      'status --json': { code: 0, stdout: STATUS, stderr: '' },
      'serve status --json': { code: 0, stdout: '{}', stderr: '' },
    }).read();
    expect(reading).toEqual({
      kind: 'ready',
      hostname: 'mac.tail1234.ts.net',
      handler: null,
      funnel: false,
    });
  });

  it('passes on what Tailscale said when status fails', async () => {
    const reading = await cliWith({
      'status --json': {
        code: 1,
        stdout: '',
        stderr: 'failed to connect to local Tailscale service\n',
      },
    }).read();
    expect(reading).toEqual({
      kind: 'error',
      message:
        'Tailscale is not running or did not answer. Open Tailscale on this Mac, then try again. Tailscale said: failed to connect to local Tailscale service',
    });
  });

  it('says Tailscale is running when only its Serve settings cannot be read', async () => {
    const reading = await cliWith({
      'status --json': { code: 0, stdout: STATUS, stderr: '' },
      'serve status --json': {
        code: 1,
        stdout: '',
        stderr: 'Serve is not enabled on your tailnet.\n',
      },
    }).read();
    expect(reading).toEqual({
      kind: 'error',
      message:
        'Tailscale is running, but Spark could not read its Serve settings. Tailscale said: Serve is not enabled on your tailnet.',
    });
  });

  it('says so when Tailscale takes too long', async () => {
    const reading = await cliWith({
      'status --json': { code: 1, stdout: '', stderr: '', timedOut: true },
    }).read();
    expect(reading).toEqual({
      kind: 'error',
      message: 'Tailscale took too long to answer. Open Tailscale on this Mac, then try again.',
    });
  });

  it('keeps the plain message when Tailscale says nothing', async () => {
    const reading = await cliWith({
      'status --json': { code: 0, stdout: 'not json', stderr: '' },
    }).read();
    expect(reading).toEqual({
      kind: 'error',
      message:
        'Tailscale is not running or did not answer. Open Tailscale on this Mac, then try again.',
    });
  });
});
