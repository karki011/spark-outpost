import { PUSH_CONTACT_DEFAULT } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_FORMAT,
  CONTACT_NOT_PUBLIC,
  CONTACT_TAILNET,
  normalizePushContact,
  pushContactProblem,
  pushSubject,
} from './push-contact.ts';

const SERVE = 'mac.tail1234.ts.net';

describe('a push sender contact', () => {
  it.each([
    'mailto:me@example.org',
    'mailto:first.last+spark@mail.example.co.uk',
    'https://example.org',
    'https://example.org/spark',
    PUSH_CONTACT_DEFAULT,
  ])('accepts %s', (contact) => {
    expect(pushContactProblem(contact, SERVE)).toBeNull();
  });

  it.each([
    ['mailto:notifications@spark-outpost.invalid', CONTACT_NOT_PUBLIC],
    ['mailto:me@localhost', CONTACT_NOT_PUBLIC],
    ['mailto:me@mac.local', CONTACT_NOT_PUBLIC],
    ['mailto:me@spark.test', CONTACT_NOT_PUBLIC],
    ['mailto:me@router.lan', CONTACT_NOT_PUBLIC],
    ['mailto:me@printer.home.arpa', CONTACT_NOT_PUBLIC],
    ['mailto:me@intranet', CONTACT_NOT_PUBLIC],
    ['mailto:me@192.168.1.4', CONTACT_NOT_PUBLIC],
    ['https://10.0.0.1/', CONTACT_NOT_PUBLIC],
    ['https://example.internal', CONTACT_NOT_PUBLIC],
    [`https://${SERVE}`, CONTACT_TAILNET],
    ['https://other.tail9999.ts.net/page', CONTACT_TAILNET],
    ['mailto:me@MAC.TAIL1234.TS.NET', CONTACT_TAILNET],
    ['mailto: me@example.org', CONTACT_FORMAT],
    ['mailto:<me@example.org>', CONTACT_FORMAT],
    ['mailto:me@example.org?subject=hi', CONTACT_FORMAT],
    ['mailto:a@example.org,b@example.org', CONTACT_FORMAT],
    ['http://example.org', CONTACT_FORMAT],
    ['https://user:pass@example.org', CONTACT_FORMAT],
    ['https://example.org:8443', CONTACT_FORMAT],
    ['example.org', CONTACT_FORMAT],
    ['', CONTACT_FORMAT],
    [`mailto:me@${'a'.repeat(200)}.org`, CONTACT_FORMAT],
  ])('refuses %s', (contact, problem) => {
    expect(pushContactProblem(contact, SERVE)).toBe(problem);
  });

  it('turns a plain email address into a mailto contact and leaves the rest alone', () => {
    expect(normalizePushContact(' me@example.org ')).toBe('mailto:me@example.org');
    expect(normalizePushContact('https://example.org')).toBe('https://example.org');
    expect(normalizePushContact('mailto:me@example.org')).toBe('mailto:me@example.org');
  });

  it('signs with the default when nothing usable is saved', () => {
    expect(pushSubject(null, SERVE)).toBe(PUSH_CONTACT_DEFAULT);
    expect(pushSubject(`https://${SERVE}`, SERVE)).toBe(PUSH_CONTACT_DEFAULT);
    expect(pushSubject('mailto:me@example.org', SERVE)).toBe('mailto:me@example.org');
  });
});
