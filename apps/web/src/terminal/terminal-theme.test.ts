// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { colorsFromTokens, themeFromTokens } from './terminal-theme.ts';

function element(colorScheme: string) {
  const node = document.createElement('div');
  node.style.setProperty('--code', '#101010');
  node.style.setProperty('--text', '#202020');
  node.style.setProperty('--muted', '#303030');
  node.style.setProperty('--accent', '#404040');
  node.style.colorScheme = colorScheme;
  document.body.append(node);
  return node;
}

describe('themeFromTokens', () => {
  it('builds the terminal colors from the theme tokens', () => {
    const theme = themeFromTokens(element('dark'));
    expect(theme).toMatchObject({
      background: '#101010',
      foreground: '#202020',
      cursor: '#404040',
    });
    expect(theme.white).toBeUndefined();
  });

  it('keeps white text readable on light themes', () => {
    const theme = themeFromTokens(element('light'));
    expect(theme).toMatchObject({ white: '#303030', brightWhite: '#202020' });
  });
});

describe('colorsFromTokens', () => {
  it('reports the same foreground and background the terminal draws with', () => {
    expect(colorsFromTokens(element('light'))).toEqual({
      foreground: '#202020',
      background: '#101010',
    });
  });

  it('writes a short or upper-case colour as six lower-case digits', () => {
    const node = element('light');
    node.style.setProperty('--text', '#000');
    node.style.setProperty('--code', '#FAF2EB');
    expect(colorsFromTokens(node)).toEqual({ foreground: '#000000', background: '#faf2eb' });
  });

  it('reports nothing when a colour is not hexadecimal', () => {
    const node = element('light');
    node.style.setProperty('--code', 'rgb(1 2 3)');
    expect(colorsFromTokens(node)).toBeNull();
  });
});
