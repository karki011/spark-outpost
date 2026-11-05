import { describe, expect, it } from 'vitest';
import { cloneArguments, cloneEnvironment } from './clone-git.ts';

describe('git clone invocation', () => {
  it('puts the address and folder after -- and never recurses into submodules', () => {
    const args = cloneArguments({
      url: 'https://github.com/acme/widgets.git',
      destination: '/Users/me/Documents/widgets',
      config: ['-c', 'credential.helper='],
    });
    expect(args.slice(-3)).toEqual([
      '--',
      'https://github.com/acme/widgets.git',
      '/Users/me/Documents/widgets',
    ]);
    expect(args.slice(0, 2)).toEqual(['-c', 'credential.helper=']);
    expect(args).toContain('--no-recurse-submodules');
    expect(args).toContain('core.hooksPath=/dev/null');
    expect(args.join(' ')).not.toMatch(/--template|--recurse-submodules\b|--depth/);
  });

  it('allows only https and ssh and can never prompt', () => {
    const env = cloneEnvironment(
      {
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'ghp_shouldNotBeInherited000000000000000000',
        GIT_DIR: '/somewhere/.git',
        GIT_TEMPLATE_DIR: '/evil/template',
      },
      { allowFileProtocol: false },
    );
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      GIT_ALLOW_PROTOCOL: 'https:ssh',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      SSH_ASKPASS_REQUIRE: 'never',
    });
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('GIT_DIR');
    expect(env).not.toHaveProperty('GIT_TEMPLATE_DIR');
  });

  it('adds the file protocol only for the injected test option', () => {
    expect(cloneEnvironment({}, { allowFileProtocol: true }).GIT_ALLOW_PROTOCOL).toBe(
      'https:ssh:file',
    );
  });
});
