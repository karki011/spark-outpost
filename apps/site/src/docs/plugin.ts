import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { buildDocs, GUIDE_DIR, GUIDE_IMAGES } from './guide.ts';
import { docFile, IMAGE_BASE, slugForPath } from './urls.ts';

const TEMPLATE = resolve(import.meta.dirname, '../../docs/index.html');

function writeDocs(outDir: string): void {
  const docsDir = resolve(outDir, 'docs');
  const { pages, images } = buildDocs(readFileSync(resolve(docsDir, 'index.html'), 'utf8'));
  for (const [file, html] of pages) writeFileSync(resolve(docsDir, file), html);
  mkdirSync(resolve(docsDir, 'images'), { recursive: true });
  for (const image of images)
    copyFileSync(resolve(GUIDE_IMAGES, image), resolve(docsDir, 'images', image));
}

export function docsPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'spark-docs',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      if (config.command === 'build') writeDocs(resolve(config.root, config.build.outDir));
    },
    configureServer(server) {
      server.watcher.add(GUIDE_DIR);
      server.watcher.on('all', (_event, file) => {
        if (file.startsWith(GUIDE_DIR)) server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://site').pathname;
        const image = resolve(GUIDE_IMAGES, basename(pathname));
        if (pathname.startsWith(IMAGE_BASE) && pathname.endsWith('.png') && existsSync(image)) {
          response.setHeader('Content-Type', 'image/png');
          response.end(readFileSync(image));
          return;
        }
        const slug = slugForPath(pathname);
        if (!slug) return next();
        const html = buildDocs(readFileSync(TEMPLATE, 'utf8')).pages.get(docFile(slug));
        if (!html) return next();
        server
          .transformIndexHtml(pathname, html)
          .then((page) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(page);
          })
          .catch(next);
      });
    },
  };
}
