import { describe, expect, it } from 'vitest';
import { setupFieldProblem } from './setup-fields.ts';

describe('what an agent may prefill for a connection', () => {
  it('takes the non-secret fields of the target', () => {
    expect(
      setupFieldProblem('atlassian', { siteUrl: 'acme.atlassian.net', email: 'me@acme.test' }),
    ).toBeNull();
    expect(
      setupFieldProblem('custom', {
        baseUrl: 'https://llm.acme.test/v1',
        model: 'big',
        keyHeader: 'x-api-key',
      }),
    ).toBeNull();
    expect(setupFieldProblem('github', {})).toBeNull();
  });

  it('refuses a field named like a secret, whatever the target', () => {
    for (const field of ['apiKey', 'token', 'password', 'clientSecret']) {
      expect(setupFieldProblem('atlassian', { [field]: 'x' })).toContain('user types');
    }
  });

  it('refuses a value that looks like a secret', () => {
    const problem = setupFieldProblem('servicenow', {
      username: 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWx',
    });
    expect(problem).toContain('looks like a secret');
  });

  it('refuses a field the target does not have', () => {
    expect(setupFieldProblem('linear', { siteUrl: 'acme.test' })).toContain('none');
    expect(setupFieldProblem('atlassian', { instanceUrl: 'acme.test' })).toContain(
      'siteUrl, email',
    );
  });

  it('refuses an address with a login, a query or another scheme', () => {
    expect(setupFieldProblem('custom', { baseUrl: 'https://me:pw@acme.test' })).toContain('login');
    expect(setupFieldProblem('custom', { baseUrl: 'https://acme.test/?k=1' })).toContain('query');
    expect(setupFieldProblem('servicenow', { instanceUrl: 'file:///etc' })).toContain(
      'web address',
    );
  });

  it('keeps choices to the ones the form offers', () => {
    expect(setupFieldProblem('claude', { method: 'cli' })).toBeNull();
    expect(setupFieldProblem('claude', { method: 'oauth' })).toContain('cli, api_key');
    expect(setupFieldProblem('servicenow', { authKind: 'sso' })).toContain('basic, api_key');
  });
});
