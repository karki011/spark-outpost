import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRates, type Fetcher } from '../src/rates.ts';

test('safety: a failed response is not cached', async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ base: 'PLN', rates: { EUR: 0.23 } }) };
  };
  await assert.rejects(fetchRates(fetcher, 'PLN'));
  assert.deepEqual(await fetchRates(fetcher, 'PLN'), { base: 'PLN', rates: { EUR: 0.23 } });
  assert.equal(calls, 2);
});

test('safety: a network error is not cached', async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    if (calls === 1) throw new Error('socket hang up');
    return { ok: true, status: 200, json: async () => ({ base: 'CZK', rates: { EUR: 0.04 } }) };
  };
  await assert.rejects(fetchRates(fetcher, 'CZK'));
  assert.deepEqual(await fetchRates(fetcher, 'CZK'), { base: 'CZK', rates: { EUR: 0.04 } });
});
