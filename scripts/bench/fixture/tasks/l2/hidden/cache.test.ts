import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRates, type Fetcher } from '../src/rates.ts';

function counting(base: string) {
  const urls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ base, rates: { EUR: urls.length } }) };
  };
  return { urls, fetcher };
}

test('repeated calls for the same base currency call the API once', async () => {
  const { urls, fetcher } = counting('CHF');
  const first = await fetchRates(fetcher, 'CHF');
  const second = await fetchRates(fetcher, 'CHF');
  assert.deepEqual(second, first);
  assert.equal(urls.length, 1);
});

test('different base currencies are cached separately', async () => {
  const { urls, fetcher } = counting('SEK');
  await fetchRates(fetcher, 'SEK');
  await fetchRates(fetcher, 'NOK');
  await fetchRates(fetcher, 'SEK');
  assert.equal(urls.length, 2);
});
