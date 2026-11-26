// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingPairing, RemoteDevice } from '@spark-outpost/contracts';
import { DeviceRow } from './DeviceRow.tsx';
import { COPY_PAIRING_LINK, PairScene } from './PairScene.tsx';
import type { PairStage } from './pair-flow.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const DEVICE: RemoteDevice = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Laptop Mac',
  kind: 'spark',
  createdAt: '2026-11-20T10:00:00Z',
  lastSeenAt: '2026-11-24T11:00:00Z',
  revokedAt: null,
  replacedBy: null,
  duplicateOf: null,
  expired: false,
  connected: false,
  passkeys: [],
};
const REQUEST: PendingPairing = {
  id: DEVICE.id,
  deviceName: 'Laptop Mac',
  kind: 'spark',
  matchCode: '482 913',
  expiresAt: '2026-11-24T12:02:00Z',
};

function row(device: RemoteDevice) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ul>
        <DeviceRow device={device} fresh={false} now={NOW} />
      </ul>
    </QueryClientProvider>,
  );
}

function scene(stage: PairStage) {
  render(
    <PairScene
      stage={stage}
      activation={null}
      hidden={false}
      hostname="mac.tail1234.ts.net"
      busy={false}
      error={null}
      onStart={() => undefined}
      onAnswer={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a Spark among the devices', () => {
  it('is named as Spark Outpost and has no passkey line', () => {
    row(DEVICE);
    expect(screen.getByText('Spark Outpost')).toBeTruthy();
    expect(screen.queryByText(/No passkey/)).toBeNull();
  });

  it('leaves a browser row without the words', () => {
    row({ ...DEVICE, kind: 'browser' });
    expect(screen.queryByText('Spark Outpost')).toBeNull();
    expect(screen.getByText(/No passkey/)).toBeTruthy();
  });
});

describe('the pair scene', () => {
  it('shows the kind of a Spark that asks to pair', () => {
    scene({ kind: 'found', request: REQUEST });
    expect(screen.getByText('Spark Outpost')).toBeTruthy();
    expect(screen.getByLabelText('Matching code 482 913')).toBeTruthy();
  });

  it('shows no kind for a browser', () => {
    scene({ kind: 'found', request: { ...REQUEST, kind: 'browser' } });
    expect(screen.queryByText('Spark Outpost')).toBeNull();
  });

  it('copies the pairing link the QR holds', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    scene({
      kind: 'code',
      pairing: { id: DEVICE.id, code: 'ABCD-EFGH-JKLM', expiresAt: REQUEST.expiresAt },
      remainingMs: 90_000,
      expiring: false,
    });
    fireEvent.click(screen.getByRole('button', { name: COPY_PAIRING_LINK }));
    expect(writeText).toHaveBeenCalledWith('https://mac.tail1234.ts.net/#code=ABCD-EFGH-JKLM');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
