import { describe, expect, it } from 'vitest';
import { create, fakeEnv, postForm, postJson, call, VALID_CREATE } from './test-fakes.ts';

const THEME = {
  scheme: 'light',
  bg: '#f6f1ed',
  card: '#fffdfb',
  text: '#241a13',
  muted: '#614a3b',
  line: '#8f8378',
  accent: '#b34f00',
  accentInk: '#ffffff',
  ok: '#1f7335',
  bad: '#ba3129',
  strip: '#f5eae1',
};

describe('share themes', () => {
  it('colours the unlock, verified and viewer pages with the theme', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake, { ...VALID_CREATE, passcode: 'ABCD2345', theme: THEME });

    const locked = await (await call(fake, `/a/${id}`)).text();
    expect(locked).toContain('color-scheme: light;');
    expect(locked).toContain('--accent: #b34f00;');
    expect(locked).toContain('--accent-ink: #ffffff;');

    const verified = await postForm(fake, `/a/${id}/unlock`, { code: 'ABCD2345' });
    expect(await verified.text()).toContain('--ok: #1f7335;');

    const cookie = verified.headers.get('set-cookie')!.split(';')[0]!;
    const shell = await (await call(fake, `/a/${id}`, { headers: { cookie } })).text();
    expect(shell).toContain('--strip: #f5eae1;');
  });

  it('keeps the neutral look for a share with no theme', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake, VALID_CREATE);
    const shell = await (await call(fake, `/a/${id}`)).text();
    expect(shell).not.toContain('--accent-ink:');
    expect(shell).toContain('color-scheme: light dark;');
  });

  it.each([
    ['a value that is not a colour', { ...THEME, accent: 'red; } body { display: none' }],
    ['an upper-case or short colour', { ...THEME, bg: '#FFF' }],
    ['a missing colour', { ...THEME, strip: undefined }],
    ['an extra field', { ...THEME, font: 'serif' }],
    ['an unknown scheme', { ...THEME, scheme: 'sepia' }],
    ['a theme that is not an object', '#b34f00'],
  ])('refuses %s and stores nothing', async (_name, theme) => {
    const fake = fakeEnv();
    const response = await postJson(fake, { ...VALID_CREATE, theme });
    expect(response.status).toBe(400);
    expect(fake.bucket.objects.size).toBe(0);
  });
});
