import { describe, expect, it } from 'vitest';
import { handleProblem, RESERVED_HANDLES, suggestHandle } from './outpost-handles.ts';
import { outpostHandleSchema } from './outposts.ts';

describe('handleProblem', () => {
  it('accepts handles of two to sixteen characters', () => {
    expect(handleProblem('fe', [])).toBeNull();
    expect(handleProblem('api', ['fe'])).toBeNull();
    expect(handleProblem('a'.repeat(16), [])).toBeNull();
    expect(handleProblem('docs-v2', [])).toBeNull();
  });

  it('names a length problem', () => {
    expect(handleProblem('', [])).toBe('Enter a handle.');
    expect(handleProblem('a', [])).toBe('A handle needs at least 2 characters.');
    expect(handleProblem('a'.repeat(17), [])).toBe('A handle can have at most 16 characters.');
  });

  it('names a character problem', () => {
    expect(handleProblem('1api', [])).toBe('A handle starts with a lower-case letter.');
    expect(handleProblem('-api', [])).toBe('A handle starts with a lower-case letter.');
    expect(handleProblem('Api', [])).toBe('A handle starts with a lower-case letter.');
    expect(handleProblem('@api', [])).toBe('A handle starts with a lower-case letter.');
    for (const handle of ['aPi', 'a_pi', 'a pi', 'a.pi', 'apé']) {
      expect(handleProblem(handle, [])).toBe(
        'A handle can use lower-case letters, numbers and hyphens only.',
      );
    }
  });

  it('refuses the reserved handle', () => {
    expect(RESERVED_HANDLES).toContain('all');
    expect(handleProblem('all', [])).toBe('@all is reserved. Choose another handle.');
    expect(handleProblem('alls', [])).toBeNull();
  });

  it('refuses a handle another member has', () => {
    expect(handleProblem('api', ['fe', 'api'])).toBe('@api is already used in this outpost.');
  });

  it('never mentions the harness', () => {
    const problems = ['', 'a', 'a'.repeat(17), '1a', 'a_b', 'all', 'api'].map((handle) =>
      handleProblem(handle, ['api']),
    );
    for (const problem of problems) {
      expect(problem).not.toBeNull();
      expect(problem?.toLowerCase()).not.toContain('harness');
    }
  });
});

describe('suggestHandle', () => {
  it('makes a handle from a project name', () => {
    expect(suggestHandle('api', [])).toBe('api');
    expect(suggestHandle('Orders API', [])).toBe('orders-api');
    expect(suggestHandle('spark_out.web', [])).toBe('spark-out-web');
    expect(suggestHandle('  docs  ', [])).toBe('docs');
  });

  it('drops what cannot start a handle', () => {
    expect(suggestHandle('2024-frontend', [])).toBe('frontend');
    expect(suggestHandle('--web', [])).toBe('web');
  });

  it('cuts a long name to sixteen characters without a trailing hyphen', () => {
    expect(suggestHandle('customer-orders-service', [])).toBe('customer-orders');
    expect(suggestHandle('abcdefghijklmnopqrstuvwxyz', [])).toBe('abcdefghijklmnop');
  });

  it('falls back when the name gives fewer than two usable characters', () => {
    expect(suggestHandle('', [])).toBe('chat');
    expect(suggestHandle('x', [])).toBe('chat');
    expect(suggestHandle('日本語', [])).toBe('chat');
    expect(suggestHandle('123', [])).toBe('chat');
  });

  it('numbers a suggestion that is taken', () => {
    expect(suggestHandle('api', ['api'])).toBe('api2');
    expect(suggestHandle('api', ['api', 'api2', 'api3'])).toBe('api4');
    expect(suggestHandle('', ['chat'])).toBe('chat2');
  });

  it('never suggests the reserved handle', () => {
    expect(suggestHandle('all', [])).toBe('all2');
    expect(suggestHandle('All', ['all2'])).toBe('all3');
  });

  it('keeps a numbered suggestion within sixteen characters', () => {
    const full = 'abcdefghijklmnop';
    expect(suggestHandle(full, [full])).toBe('abcdefghijklmno2');
    expect(suggestHandle('customer-orders-x', ['customer-orders'])).toBe('customer-orders2');
    const nine = Array.from({ length: 8 }, (_, index) => `abcdefghijklmno${index + 2}`);
    expect(suggestHandle(full, [full, ...nine])).toBe('abcdefghijklmn10');
  });

  it('always suggests a handle that has no problem', () => {
    const names = ['', 'x', 'all', 'Orders API', '9 lives', 'a-', 'customer-orders-service', 'é'];
    const taken: string[] = [];
    for (const name of [...names, ...names]) {
      const handle = suggestHandle(name, taken);
      expect(handleProblem(handle, taken)).toBeNull();
      expect(outpostHandleSchema.safeParse(handle).success).toBe(true);
      taken.push(handle);
    }
  });
});
