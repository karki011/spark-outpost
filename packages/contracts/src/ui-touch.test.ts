import { describe, expect, it } from 'vitest';
import { isUiFile, touchesUi } from './ui-touch.ts';

describe('interface work', () => {
  it('knows components, styles, templates and pages by their path', () => {
    for (const path of [
      'apps/web/src/chat/Composer.tsx',
      'src/styles/theme.css',
      'app/views/orders/show.html.erb',
      'templates/base.html',
      'src/pages/index.astro',
      'web/components/nav.js',
      'src/App.vue',
    ]) {
      expect(isUiFile(path), path).toBe(true);
    }
    for (const path of ['apps/server/src/api/main.ts', 'README.md', 'migrations/0001_init.sql']) {
      expect(isUiFile(path), path).toBe(false);
    }
  });

  it('counts a task as interface work from its files or from what the request says', () => {
    expect(touchesUi('Fix the retry count', ['src/chat/Composer.tsx'])).toBe(true);
    expect(touchesUi('Make the Save button wider on the settings screen', [])).toBe(true);
    expect(touchesUi('Tidy the dark mode colours', ['src/theme.ts'])).toBe(true);
    expect(touchesUi('Fix the retry count in the queue worker', ['src/queue/worker.ts'])).toBe(
      false,
    );
    expect(touchesUi('Build the release', [])).toBe(false);
  });
});
