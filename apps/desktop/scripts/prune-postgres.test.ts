import { describe, expect, it } from 'vitest';
import {
  keepsExtensionFile,
  keepsServerModule,
  linkedClosure,
  loaderPathLinks,
} from './prune-postgres.ts';

describe('Postgres server modules', () => {
  it('keeps PL/pgSQL, the snowball dictionaries initdb loads and encoding conversions', () => {
    for (const kept of [
      'plpgsql.dylib',
      'dict_snowball.dylib',
      'utf8_and_win.dylib',
      'latin_and_mic.dylib',
    ]) {
      expect(keepsServerModule(kept)).toBe(true);
    }
    for (const dropped of [
      'pgcrypto.dylib',
      'plperl.dylib',
      'postgres_fdw.dylib',
      'uuid-ossp.dylib',
    ]) {
      expect(keepsServerModule(dropped)).toBe(false);
    }
  });

  it('keeps only the plpgsql extension scripts', () => {
    expect(keepsExtensionFile('plpgsql.control')).toBe(true);
    expect(keepsExtensionFile('plpgsql--1.0.sql')).toBe(true);
    expect(keepsExtensionFile('pgcrypto.control')).toBe(false);
    expect(keepsExtensionFile('plperl.control')).toBe(false);
  });
});

describe('loaderPathLinks', () => {
  it('resolves bundled libraries and skips system ones and the install name', () => {
    const output = [
      '/pg/lib/libssl.3.dylib:',
      '\t/Library/PostgreSQL/17/lib/libssl.3.dylib (compatibility version 3.0.0)',
      '\t@loader_path/../lib/libcrypto.3.dylib (compatibility version 3.0.0)',
      '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)',
    ].join('\n');
    expect(loaderPathLinks('/pg/lib/libssl.3.dylib', output)).toEqual([
      '/pg/lib/libcrypto.3.dylib',
    ]);
  });

  it('fails loudly on a link it cannot place', () => {
    const output = [
      '/pg/bin/postgres:',
      '\t@rpath/libz.1.dylib (compatibility version 1.0.0)',
    ].join('\n');
    expect(() => loaderPathLinks('/pg/bin/postgres', output)).toThrow('@rpath/libz.1.dylib');
  });
});

describe('linkedClosure', () => {
  it('follows links transitively and visits each file once', async () => {
    const links: Record<string, string[]> = {
      postgres: ['libssl', 'libicuuc'],
      initdb: ['libpq', 'libicuuc'],
      libpq: ['libssl'],
      libssl: ['libcrypto'],
      libicuuc: ['libicudata'],
    };
    const visits: string[] = [];
    const closure = await linkedClosure(['postgres', 'initdb'], async (file) => {
      visits.push(file);
      return links[file] ?? [];
    });
    expect([...closure].sort()).toEqual(
      ['initdb', 'libcrypto', 'libicudata', 'libicuuc', 'libpq', 'libssl', 'postgres'].sort(),
    );
    expect(visits).toHaveLength(closure.size);
  });
});
