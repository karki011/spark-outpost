import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRates, type Fetcher } from '../src/rates.ts';

test('fetchRates returns the parsed body', async () => {
  const fetcher: Fetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ base: 'NZD', rates: { USD: 0.6 } }),
  });
  assert.deepEqual(await fetchRates(fetcher, 'NZD'), { base: 'NZD', rates: { USD: 0.6 } });
});

test('fetchRates throws when the response is not ok', async () => {
  const fetcher: Fetcher = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(fetchRates(fetcher, 'ISK'), /503/);
});
