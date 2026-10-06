import { describe, expect, it } from 'vitest';
import { peelSubstitutions } from './substitutions.ts';

const peel = (script: string) => peelSubstitutions(script, '$X');

describe('peelSubstitutions', () => {
  it('takes command substitutions out of a command, quoted or not', () => {
    expect(peel('gh pr comment --body "$(cat reply.md)"')).toEqual({
      outer: 'gh pr comment --body "$X"',
      inner: ['cat reply.md'],
    });
    expect(peel('echo `date` "$(git log -1 --format="%h (%s)")" done')).toEqual({
      outer: 'echo $X "$X" done',
      inner: ['date', 'git log -1 --format="%h (%s)"'],
    });
  });

  it('keeps nested substitutions inside the one that holds them', () => {
    expect(peel('a "$(b "$(c)")"')).toEqual({ outer: 'a "$X"', inner: ['b "$(c)"'] });
  });

  it('leaves single quotes, escapes and arithmetic alone', () => {
    const plain = `echo '$(not run)' \\$(nor this) $((1 + 2))`;
    expect(peel(plain)).toEqual({ outer: plain, inner: [] });
  });

  it('gives up on a substitution or a quote that never closes', () => {
    expect(peel('echo "$(cat notes.md"')).toBeNull();
    expect(peel('echo `date')).toBeNull();
    expect(peel('echo "open')).toBeNull();
  });
});
