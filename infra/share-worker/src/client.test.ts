import { describe, expect, it } from 'vitest';
import { clientKeyFor } from './client.ts';

describe('the key a client address is counted under', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(clientKeyFor('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKeyFor(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('groups every IPv6 address of one /64 under the same key', () => {
    const key = clientKeyFor('2001:db8:12:34::1');
    expect(key).toBe('2001:db8:12:34::/64');
    expect(clientKeyFor('2001:0DB8:0012:0034:ffff:ffff:ffff:ffff')).toBe(key);
    expect(clientKeyFor('2001:db8:12:34:a:b:c:d%eth0')).toBe(key);
    expect(clientKeyFor('2001:db8:12:35::1')).not.toBe(key);
  });

  it('expands a shortened address before taking its network', () => {
    expect(clientKeyFor('::1')).toBe('0:0:0:0::/64');
    expect(clientKeyFor('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(clientKeyFor('2001:db8::1:2:3:4:5')).toBe('2001:db8:0:1::/64');
  });

  it('counts an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(clientKeyFor('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKeyFor('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('puts a missing or malformed address under one shared key', () => {
    for (const address of [
      null,
      '',
      'not an address',
      '999.1.1.1',
      '1.2.3',
      '2001:db8:::1',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      '2001:db8::g',
      '::ffff:999.0.0.1',
      'a'.repeat(200),
    ]) {
      expect(clientKeyFor(address)).toBe('unknown');
    }
  });
});
