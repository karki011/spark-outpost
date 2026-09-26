// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { themeFromTokens } from './terminal-theme.ts';

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
