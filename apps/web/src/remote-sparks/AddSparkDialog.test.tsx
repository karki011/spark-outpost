// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPARK_ADDRESS_PROBLEMS } from '@spark-outpost/contracts';
import { AddSparkDialog } from './AddSparkDialog.tsx';
import { NAME_PROBLEM, TRUST_LABEL, UNTRUSTED_LEAD } from './remote-sparks-copy.ts';

const SETTLE = { timeout: 3000 };
const OWN = 'mine.tail1234.ts.net';
const SAVED = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Mac',
  hostname: 'studio.tail1234.ts.net',
  reach: 'tailscale',
  paired: false,
  status: 'not-paired',
  needsYou: 0,
  icon: null,
  createdAt: '2026-11-20T10:00:00Z',
  lastOpenedAt: null,
};

function serve(status: number, body: unknown) {
  const sent: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') sent.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? body
            : {
                available: true,
                local: { name: null, defaultName: 'Hazel’s MacBook', icon: null },
                sparks: [],
              },
        ),
        {
          status: init?.method === 'POST' ? status : 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }),
  );
  return sent;
}

function show() {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddSparkDialog ownHostname={OWN} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const ADDRESS = 'Address or pairing link';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AddSparkDialog', () => {
  it('starts in the address field with no complaint', () => {
    serve(201, SAVED);
    show();
    expect(document.activeElement).toBe(screen.getByLabelText(ADDRESS));
    expect(screen.getByLabelText(ADDRESS).getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByLabelText('Name').getAttribute('placeholder')).toBe('Studio Mac');
  });

  it.each([
    ['http://studio.tail1234.ts.net', SPARK_ADDRESS_PROBLEMS.scheme],
    ['https://studio.tail1234.ts.net:8443', SPARK_ADDRESS_PROBLEMS.shape],
    ['https://203.0.113.7', SPARK_ADDRESS_PROBLEMS.host],
    [`https://${OWN}`, SPARK_ADDRESS_PROBLEMS.own],
  ])('explains what is wrong with %s while typing', (address, problem) => {
    serve(201, SAVED);
    show();
    type(ADDRESS, address);
    expect(screen.getByText(problem)).toBeTruthy();
    expect(screen.getByLabelText(ADDRESS).getAttribute('aria-invalid')).toBe('true');
  });

  it('says where a good address opens and whether the code comes with it', () => {
    serve(201, SAVED);
    show();
    type(ADDRESS, 'studio.tail1234.ts.net');
    expect(
      screen.getByText('Opens studio.tail1234.ts.net. You type the pairing code there.'),
    ).toBeTruthy();
    type(ADDRESS, 'https://studio.tail1234.ts.net/#code=ABCD-EFGH-JKLM');
    expect(
      screen.getByText('Opens studio.tail1234.ts.net with its pairing code filled in.'),
    ).toBeTruthy();
  });

  it('asks for both fields before it sends anything', () => {
    const sent = serve(201, SAVED);
    show();
    fireEvent.submit(screen.getByLabelText(ADDRESS).closest('form')!);
    expect(screen.getByText(SPARK_ADDRESS_PROBLEMS.empty)).toBeTruthy();
    expect(screen.getByText(NAME_PROBLEM)).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it('adds the Spark and closes', async () => {
    const sent = serve(201, SAVED);
    const onClose = show();
    type(ADDRESS, ' https://studio.tail1234.ts.net ');
    type('Name', ' Studio Mac ');
    fireEvent.submit(screen.getByLabelText(ADDRESS).closest('form')!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), SETTLE);
    expect(sent).toEqual([{ address: 'https://studio.tail1234.ts.net', name: 'Studio Mac' }]);
  });

  it('has no warning or trust box for a Tailscale address', () => {
    serve(201, SAVED);
    show();
    type(ADDRESS, 'studio.tail1234.ts.net');
    expect(screen.queryByText(UNTRUSTED_LEAD)).toBeNull();
    expect(screen.queryByLabelText(TRUST_LABEL)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a computer' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('asks to trust a custom domain before it can be added', async () => {
    const sent = serve(201, { ...SAVED, hostname: 'spark.example.com', reach: 'custom' });
    const onClose = show();
    type(ADDRESS, 'https://spark.example.com');
    type('Name', 'Cabin Mac');
    expect(screen.getByText(UNTRUSTED_LEAD).tagName).toBe('B');
    const add = screen.getByRole('button', { name: 'Add a computer' });
    expect(add).toHaveProperty('disabled', true);
    fireEvent.submit(screen.getByLabelText(ADDRESS).closest('form')!);
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(TRUST_LABEL));
    expect(add).toHaveProperty('disabled', false);
    fireEvent.submit(screen.getByLabelText(ADDRESS).closest('form')!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), SETTLE);
    expect(sent).toEqual([
      { address: 'https://spark.example.com', name: 'Cabin Mac', trusted: true },
    ]);
  });

  it('asks again when the address changes after the tick', () => {
    serve(201, SAVED);
    show();
    type(ADDRESS, 'spark.example.com');
    fireEvent.click(screen.getByLabelText(TRUST_LABEL));
    type(ADDRESS, 'other.example.com');
    expect(screen.getByLabelText(TRUST_LABEL)).toHaveProperty('checked', false);
  });

  it('shows what the server refused in one line and stays open', async () => {
    serve(409, { error: 'That Spark is already saved as Studio Mac.' });
    const onClose = show();
    type(ADDRESS, 'studio.tail1234.ts.net');
    type('Name', 'Studio again');
    fireEvent.submit(screen.getByLabelText(ADDRESS).closest('form')!);
    const alert = await screen.findByRole('alert', undefined, SETTLE);
    expect(alert.textContent).toBe('That Spark is already saved as Studio Mac.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    serve(201, SAVED);
    const onClose = show();
    fireEvent.keyDown(screen.getByLabelText(ADDRESS), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
