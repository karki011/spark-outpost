import { describe, expect, it } from 'vitest';
import { isBundledService, serverEntry } from './runtime-entries.ts';

const layout = { bootstrap: '/app/dist/server-entry.js', serverDir: '/app/server' };
const api = {
  bootstrap: '/app/dist/server-entry.js',
  entry: '/app/server/src/api/main.ts',
  cwd: '/app/server',
};

describe('bundled server entries', () => {
  it('names the API, worker and migration entries under the server folder', () => {
    expect(serverEntry('/app/server', 'api')).toBe('/app/server/src/api/main.ts');
    expect(serverEntry('/app/server', 'worker')).toBe('/app/server/src/workflow/main.ts');
    expect(serverEntry('/app/server', 'migrate')).toBe(
      '/app/server/src/persistence/migrate-cli.ts',
    );
  });

  it("accepts each of the app's own entries", () => {
    for (const name of ['api', 'worker', 'migrate'] as const)
      expect(isBundledService({ ...api, entry: serverEntry('/app/server', name) }, layout)).toBe(
        true,
      );
    expect(isBundledService({ ...api, entry: '/app/server/src/../src/api/main.ts' }, layout)).toBe(
      true,
    );
  });

  it('refuses another entry, bootstrap or working folder', () => {
    expect(isBundledService({ ...api, entry: '/tmp/main.ts' }, layout)).toBe(false);
    expect(isBundledService({ ...api, entry: '/app/server/src/api/other.ts' }, layout)).toBe(false);
    expect(isBundledService({ ...api, entry: '/app/server/src/api/../../../x.ts' }, layout)).toBe(
      false,
    );
    expect(isBundledService({ ...api, entry: 'src/api/main.ts' }, layout)).toBe(false);
    expect(isBundledService({ ...api, bootstrap: '/tmp/server-entry.js' }, layout)).toBe(false);
    expect(isBundledService({ ...api, cwd: '/tmp' }, layout)).toBe(false);
  });

  it('refuses everything when the host was started without a server folder', () => {
    expect(isBundledService(api, { bootstrap: layout.bootstrap, serverDir: null })).toBe(false);
  });
});
