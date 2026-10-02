import { describe, expect, it } from 'vitest';
import { catalogEntry } from '../providers/catalog.ts';
import { detectHint } from './hints.ts';
import { shellEnvironment } from './pty.ts';

const claude = catalogEntry('claude');

const blockedOutput = [
  'added 3 packages in 6s',
  'npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:',
  'npm warn install-scripts   @anthropic-ai/claude-code@2.1.282 (postinstall: node install.cjs)',
  'npm warn install-scripts Run `npm install -g --allow-scripts=@anthropic-ai/claude-code` to allow these scripts once',
].join('\n');

describe('detectHint', () => {
  it('explains npm permission errors without suggesting sudo', () => {
    const detected = detectHint(claude, 'npm ERR! code EACCES\nnpm ERR! syscall mkdir');
    expect(detected?.hint.id).toBe('npm_permissions');
    expect(detected?.hint.message).toContain('Avoid sudo');
    expect(detected?.nextCommand).toBeNull();
  });

  it('checks again by itself after a clean install', () => {
    expect(detectHint(claude, '\u001b[32madded 3 packages\u001b[0m in 4s')).toEqual({
      hint: {
        id: 'installed',
        message: "Installed `claude`. Checking whether you're logged in.",
        checkAgain: true,
      },
      nextCommand: null,
    });
  });

  it('checks again without a login step when Z.ai installs the claude CLI', () => {
    expect(detectHint(catalogEntry('zai'), 'added 3 packages in 4s')?.hint.message).toBe(
      'Installed `claude`. Checking again.',
    );
  });

  it('does not call an install finished when npm skipped its setup script', () => {
    const detected = detectHint(claude, blockedOutput);
    expect(detected?.hint.id).toBe('install_scripts_blocked');
    expect(detected?.hint.message).toContain('may not work yet');
    expect(detected?.hint.checkAgain).toBe(false);
    expect(detected?.nextCommand).toBe(
      'npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code',
    );
  });

  it('uses the most recent problem in the output', () => {
    const text = 'npm ERR! code EACCES\n...\nzsh: command not found: claude';
    expect(detectHint(claude, text)?.hint.id).toBe('cli_not_found');
  });

  it('tells the user to check again after a successful login', () => {
    expect(
      detectHint(claude, 'Paste code here if prompted > Login successful.\n')?.hint,
    ).toMatchObject({
      id: 'logged_in',
      checkAgain: true,
    });
  });

  it('returns nothing for ordinary output', () => {
    expect(detectHint(claude, 'hello\n')).toBeNull();
  });
});

describe('shellEnvironment', () => {
  it('keeps PATH and removes secrets', () => {
    const env = shellEnvironment({
      PATH: '/usr/bin',
      DATABASE_URL: 'postgres://secret',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      GITHUB_TOKEN: 'ghp',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
    });
    expect(env).not.toHaveProperty('CLAUDECODE');
    expect(env).not.toHaveProperty('CLAUDE_CODE_CHILD_SESSION');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/Users/me/.claude-work');
    expect(env.PATH).toBe('/usr/bin');
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env.TERM).toBe('xterm-256color');
  });
});
