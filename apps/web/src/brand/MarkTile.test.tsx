// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkTile, markLetters } from './MarkTile.tsx';

describe('markLetters', () => {
  it('takes the first and last word initials', () => {
    expect(markLetters('maya chen')).toBe('MC');
    expect(markLetters('  Maya  ')).toBe('M');
    expect(markLetters('')).toBe('?');
  });

  it('keeps a character outside the basic plane whole', () => {
    expect(markLetters('😀 Li')).toBe('😀L');
  });
});

describe('MarkTile', () => {
  const letters = (size: number, text: string) =>
    render(<MarkTile letters={text} size={size} />).container.firstElementChild?.getAttribute(
      'data-letters',
    );

  it('shows two letters when large, one when medium and none when small', () => {
    expect(letters(28, 'MC')).toBe('MC');
    expect(letters(20, 'MC')).toBe('M');
    expect(letters(16, 'MC')).toBeNull();
  });

  it('never splits a character when it shortens', () => {
    expect(letters(20, '😀L')).toBe('😀');
  });
});
