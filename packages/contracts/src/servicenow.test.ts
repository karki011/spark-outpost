import { describe, expect, it } from 'vitest';
import { serviceNowInstanceUrl } from './servicenow.ts';
import { saveTicketConnectionRequestSchema } from './tickets.ts';

describe('ServiceNow instance address', () => {
  it('turns a name into the instance address', () => {
    expect(serviceNowInstanceUrl('acme')).toBe('https://acme.service-now.com');
    expect(serviceNowInstanceUrl(' Acme-Dev ')).toBe('https://acme-dev.service-now.com');
  });

  it('accepts a full https address and drops the trailing slash', () => {
    expect(serviceNowInstanceUrl('acme.service-now.com')).toBe('https://acme.service-now.com');
    expect(serviceNowInstanceUrl('https://acme.service-now.com/')).toBe(
      'https://acme.service-now.com',
    );
    expect(serviceNowInstanceUrl('https://help.acme.example')).toBe('https://help.acme.example');
  });

  it('refuses http, a login, a path or a query', () => {
    expect(serviceNowInstanceUrl('http://acme.service-now.com')).toBeNull();
    expect(serviceNowInstanceUrl('https://me:pw@acme.service-now.com')).toBeNull();
    expect(serviceNowInstanceUrl('https://acme.service-now.com/now/nav')).toBeNull();
    expect(serviceNowInstanceUrl('https://acme.service-now.com?x=1')).toBeNull();
    expect(serviceNowInstanceUrl('javascript:alert(1)')).toBeNull();
    expect(serviceNowInstanceUrl('https://acme.example:99999')).toBeNull();
    expect(serviceNowInstanceUrl('')).toBeNull();
  });

  it('allows plain http only on this computer, for the test instance', () => {
    expect(serviceNowInstanceUrl('http://127.0.0.1:4399')).toBe('http://127.0.0.1:4399');
    expect(serviceNowInstanceUrl('http://localhost:4399/')).toBe('http://localhost:4399');
  });
});

describe('connecting ServiceNow', () => {
  it('takes a password or an API key with the user name', () => {
    const basic = saveTicketConnectionRequestSchema.parse({
      source: 'servicenow',
      instanceUrl: 'acme',
      authKind: 'basic',
      username: 'jordan.lee',
      password: ' spaced pass ',
    });
    expect(basic).toEqual({
      source: 'servicenow',
      instanceUrl: 'https://acme.service-now.com',
      authKind: 'basic',
      username: 'jordan.lee',
      password: ' spaced pass ',
    });
    const key = saveTicketConnectionRequestSchema.safeParse({
      source: 'servicenow',
      instanceUrl: 'acme',
      authKind: 'api_key',
      username: 'jordan.lee',
      apiKey: 'short',
    });
    expect(key.error?.issues[0]?.message).toBe('Paste the full API key.');
  });

  it('refuses a user name that could change the query', () => {
    const result = saveTicketConnectionRequestSchema.safeParse({
      source: 'servicenow',
      instanceUrl: 'acme',
      authKind: 'basic',
      username: 'jordan^ORactive=true',
      password: 'pw',
    });
    expect(result.error?.issues[0]?.message).toBe('Use your ServiceNow user name, without spaces.');
  });
});
