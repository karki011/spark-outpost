import { describe, expect, it } from 'vitest';
import {
  OPEN_ADDRESS_LOCAL_REASON,
  OPEN_ADDRESS_LONG_REASON,
  OPEN_ADDRESS_SCHEME_REASON,
  WEB_ADDRESS_LOCAL_REASON,
  WEB_ADDRESS_LOGIN_REASON,
  WEB_ADDRESS_SCHEME_REASON,
  openAddressRefusal,
  webAddressRefusal,
} from './web-address.ts';

describe('an address an agent asks the user to open', () => {
  it('opens a web address, even when its query names a local callback', () => {
    expect(
      openAddressRefusal(
        'https://auth.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A5555%2Fcb',
      ),
    ).toBeNull();
    expect(openAddressRefusal('http://docs.example.com/login')).toBeNull();
  });

  it('refuses other schemes, sockets included', () => {
    for (const address of ['wss://example.com/', 'file:///etc/hosts', 'javascript:alert(1)', 'x']) {
      expect(openAddressRefusal(address)).toBe(OPEN_ADDRESS_SCHEME_REASON);
    }
  });

  it('refuses a login in the address and this computer', () => {
    expect(openAddressRefusal('https://me:pw@example.com/')).toBe(WEB_ADDRESS_LOGIN_REASON);
    for (const address of [
      'http://localhost:51235/api/health',
      'http://127.0.0.2/',
      'http://[::1]:4000/',
      'http://0.0.0.0/',
      'http://spark.localhost/',
    ]) {
      expect(openAddressRefusal(address)).toBe(OPEN_ADDRESS_LOCAL_REASON);
    }
  });

  it('refuses an address too long to show', () => {
    expect(openAddressRefusal(`https://example.com/${'a'.repeat(5000)}`)).toBe(
      OPEN_ADDRESS_LONG_REASON,
    );
  });

  it('leaves the web tools rule as it was, sockets allowed', () => {
    expect(webAddressRefusal('wss://example.com/')).toBeNull();
    expect(webAddressRefusal('ftp://example.com/')).toBe(WEB_ADDRESS_SCHEME_REASON);
    expect(webAddressRefusal('http://localhost/')).toBe(WEB_ADDRESS_LOCAL_REASON);
  });
});
