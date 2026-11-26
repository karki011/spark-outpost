import { describe, expect, it } from 'vitest';
import { REMOTE_DEVICE_NAME_MAX } from '@spark-outpost/contracts';
import { connectRemoteSparkPort } from './bridge.ts';
import { macNameOf } from './routes.ts';

describe('this computer’s name for another Spark', () => {
  it('drops the .local ending of the computer’s host name', () => {
    expect(macNameOf('Haris-MacBook-Pro.local')).toBe('Haris-MacBook-Pro');
    expect(macNameOf('studio.LOCAL.')).toBe('studio');
    expect(macNameOf('studio.example.com')).toBe('studio.example.com');
  });

  it('is never empty and never over the device name limit', () => {
    expect(macNameOf('')).toBe('Computer');
    expect(macNameOf('.local')).toBe('Computer');
    expect(macNameOf('m'.repeat(200))).toHaveLength(REMOTE_DEVICE_NAME_MAX);
  });
});

describe('the desktop bridge', () => {
  const parent = { postMessage: () => undefined, on: () => undefined };

  it('exists only inside the desktop app', () => {
    expect(connectRemoteSparkPort({ SPARK_BROWSER_HOST: '1' }, {})).toBeNull();
    expect(connectRemoteSparkPort({}, { parentPort: parent })).toBeNull();
    expect(
      connectRemoteSparkPort({ SPARK_BROWSER_HOST: '1' }, { parentPort: parent }),
    ).not.toBeNull();
  });

  it('passes messages both ways over the parent port', () => {
    const posted: unknown[] = [];
    const heard: unknown[] = [];
    let deliver: (event: { data: unknown }) => void = () => undefined;
    const port = connectRemoteSparkPort(
      { SPARK_BROWSER_HOST: '1' },
      {
        parentPort: {
          postMessage: (message: unknown) => posted.push(message),
          on: (_event: string, listener: (event: { data: unknown }) => void) => {
            deliver = listener;
          },
        },
      },
    )!;
    const close = {
      kind: 'remote-spark:close',
      id: '0198c0de-0000-7000-8000-000000000001',
    } as const;

    port.subscribe((message) => heard.push(message));
    port.post(close);
    deliver({ data: { kind: 'remote-spark:signed-out', id: close.id } });

    expect(posted).toEqual([close]);
    expect(heard).toEqual([{ kind: 'remote-spark:signed-out', id: close.id }]);
  });
});
