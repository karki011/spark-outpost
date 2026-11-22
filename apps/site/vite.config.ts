import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { parseChangelog, releasesHtml } from './src/changelog/changelog.ts';
import { docsPlugin } from './src/docs/plugin.ts';

const CHANGELOG = resolve(import.meta.dirname, '../desktop/CHANGELOG.md');
const RELEASES_SLOT = '<ol class="releases" data-releases></ol>';
const SPRITE = resolve(import.meta.dirname, 'src/scout-sprite.svg');
const SPRITE_SLOT = '<svg class="sprite" data-sprite></svg>';

function spritePlugin(): Plugin {
  return {
    name: 'spark-sprite',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(SPRITE_SLOT, readFileSync(SPRITE, 'utf8').trim()),
    },
    configureServer(server) {
      server.watcher.add(SPRITE);
    },
  };
}

function changelogPlugin(): Plugin {
  return {
    name: 'spark-changelog',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename.endsWith('changelog.html')) return html;
        const releases = releasesHtml(parseChangelog(readFileSync(CHANGELOG, 'utf8')));
        return html.replace(RELEASES_SLOT, `<ol class="releases" data-releases>${releases}</ol>`);
      },
    },
    configureServer(server) {
      server.watcher.add(CHANGELOG);
    },
  };
}

export default defineConfig({
  plugins: [spritePlugin(), changelogPlugin(), docsPlugin()],
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        changelog: resolve(import.meta.dirname, 'changelog.html'),
        docs: resolve(import.meta.dirname, 'docs/index.html'),
      },
    },
  },
});
