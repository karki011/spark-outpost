import { describe, expect, it } from 'vitest';
import type { SavedSignIn } from '@spark-outpost/contracts';
import { checkedSignIn, draftOf } from './sign-in-draft.ts';

const saved: SavedSignIn = {
  id: '5a0f0e7e-7f2a-4d4e-9c1b-2f6f6c0a1b11',
  projectId: '5a0f0e7e-7f2a-4d4e-9c1b-2f6f6c0a1b12',
  label: 'Staging admin',
  origin: 'https://staging.example.com',
  username: 'a•••@example.com',
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-05T10:00:00.000Z',
};

describe('the saved sign-in form', () => {
  it('never starts with the saved username or password', () => {
    expect(draftOf(saved)).toEqual({
      label: 'Staging admin',
      origin: 'https://staging.example.com',
      username: '',
      password: '',
    });
  });

  it('needs every field for a new sign-in', () => {
    const { request, errors } = checkedSignIn(draftOf(null), null);
    expect(request).toBeNull();
    expect(Object.keys(errors)).toEqual(['label', 'origin', 'username', 'password']);
  });

  it('keeps the saved values when an edit leaves them empty', () => {
    const { request } = checkedSignIn({ ...draftOf(saved), label: ' Staging owner ' }, saved);
    expect(request).toEqual({ label: 'Staging owner', origin: 'https://staging.example.com' });
  });

  it('sends only the value that was typed again', () => {
    const { request } = checkedSignIn({ ...draftOf(saved), password: 'new-Passw0rd' }, saved);
    expect(request).toEqual({
      label: 'Staging admin',
      origin: 'https://staging.example.com',
      password: 'new-Passw0rd',
    });
  });

  it('asks for both values again when the keychain entry is gone', () => {
    const { errors } = checkedSignIn(draftOf(saved), { ...saved, username: null });
    expect(Object.keys(errors)).toEqual(['username', 'password']);
  });

  it('refuses plain http on a public host', () => {
    const draft = { ...draftOf(saved), origin: 'http://staging.example.com' };
    expect(checkedSignIn(draft, saved).errors.origin).toContain('Plain http');
  });
});
