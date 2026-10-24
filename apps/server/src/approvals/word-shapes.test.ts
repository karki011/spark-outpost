import { describe, expect, it } from 'vitest';
import { braceExpansions, substitutedCommand, wordShapes } from './word-shapes.ts';

const HOME = '/Users/me';

describe('brace expansion', () => {
  it('expands nested alternatives, separators included', () => {
    expect(braceExpansions('/a/{b/c,{d,e}}/f')?.sort()).toEqual(['/a/b/c/f', '/a/d/f', '/a/e/f']);
  });

  it('leaves a single item and a variable alone, and widens a range', () => {
    expect(braceExpansions('/a/{b}/c')).toEqual(['/a/{b}/c']);
    expect(braceExpansions('${HOME}/x')).toEqual(['${HOME}/x']);
    expect(braceExpansions('/a/{1..9}/x')).toEqual(['/a/*/x']);
  });

  it('gives up past 64 expansions so the caller can widen the word', () => {
    expect(braceExpansions('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}')).toBeNull();
    expect(wordShapes('/x/{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}', HOME)).toEqual([
      { text: '/x/**', anywhere: false },
    ]);
  });
});

describe('word shapes', () => {
  it('expands a home and turns unknown values into wildcards', () => {
    expect(wordShapes('~kim/notes', HOME)).toEqual([{ text: '/Users/kim/notes', anywhere: false }]);
    expect(wordShapes('$HOME/a/$NAME.json', HOME)).toEqual([
      { text: '/Users/me/a/**.json', anywhere: false },
    ]);
    expect(wordShapes('$DIR/a.json', HOME)).toEqual([{ text: '/**/a.json', anywhere: true }]);
  });

  it('drops a word that is nothing but unknown values', () => {
    expect(wordShapes('$f', HOME)).toEqual([]);
    expect(wordShapes('$f $g', HOME)).toEqual([]);
  });

  it('replaces command substitutions, innermost first', () => {
    expect(substitutedCommand('cat "$(dirname $(pwd))/x" `id`')).toBe(
      'cat "$SPARK_SUBSTITUTED/x" $SPARK_SUBSTITUTED',
    );
  });
});
