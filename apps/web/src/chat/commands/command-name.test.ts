import { describe, expect, it } from 'vitest';
import { commandName } from './command-name.ts';

describe('commandName', () => {
  it('names a command by its program, with an ellipsis for the rest', () => {
    expect(commandName('du -sh node_modules')).toBe('du…');
    expect(commandName('python3 -c "import sys; sys.exit(1)"')).toBe('python3…');
    expect(commandName('.venv/bin/python -m scripts.run_query')).toBe('python…');
    expect(commandName('ls')).toBe('ls');
  });

  it('keeps the subcommands of gh, git and package managers', () => {
    expect(commandName('gh pr checks 150 --watch')).toBe('gh pr checks…');
    expect(commandName('git status --short')).toBe('git status…');
    expect(commandName('git -C repo log')).toBe('git…');
    expect(commandName('pnpm test --filter web')).toBe('pnpm test…');
    expect(commandName('git status')).toBe('git status');
  });

  it('skips env assignments, wrappers and a leading cd', () => {
    expect(commandName('AWS_PROFILE=prod AWS_REGION=us-east-1 aws sts get-caller-identity')).toBe(
      'aws…',
    );
    expect(commandName('cd "/tmp/x y" && grep -rn foo .')).toBe('grep…');
    expect(commandName('sudo env FOO=1 make build')).toBe('make…');
  });
});
