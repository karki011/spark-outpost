import { describe, expect, it } from 'vitest';
import { SIGN_IN_HIDDEN, scrubberFor } from './scrub.ts';

const secret = { username: 'vault-user@example.test', password: 'p@ss "word" 1' };
const scrub = scrubberFor([secret])!;

describe('hiding saved sign-ins in what agents read', () => {
  it('does nothing when there is nothing saved', () => {
    expect(scrubberFor([])).toBeNull();
  });

  it('hides the values wherever they appear', () => {
    expect(scrub(`hello ${secret.username}, your password is ${secret.password}.`)).toBe(
      `hello ${SIGN_IN_HIDDEN}, your password is ${SIGN_IN_HIDDEN}.`,
    );
  });

  it('hides them as they look in an address, a form body and a JSON string', () => {
    const address = `http://localhost/?u=${encodeURIComponent(secret.username)}&p=${encodeURIComponent(secret.password)}`;
    expect(scrub(address)).toBe(`http://localhost/?u=${SIGN_IN_HIDDEN}&p=${SIGN_IN_HIDDEN}`);
    expect(scrub('p=p%40ss+%22word%22+1')).toBe(`p=${SIGN_IN_HIDDEN}`);
    expect(scrub(JSON.stringify({ password: secret.password }))).toBe(
      `{"password":"${SIGN_IN_HIDDEN}"}`,
    );
  });

  it('hides the start of a value that was cut off by a clipped line', () => {
    expect(scrub(`token ${secret.password.slice(0, 7)}…`)).toBe(`token ${SIGN_IN_HIDDEN}…`);
    expect(scrub('nothing cut here… and more')).toBe('nothing cut here… and more');
  });

  it('leaves other text alone', () => {
    expect(scrub('Dashboard for example.test')).toBe('Dashboard for example.test');
  });
});
