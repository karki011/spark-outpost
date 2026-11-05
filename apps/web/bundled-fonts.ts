import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const FONT_PACKAGES = [
  { name: '@fontsource-variable/inter', published: 'Inter Variable', family: 'Inter' },
  {
    name: '@fontsource-variable/geist-mono',
    published: 'Geist Mono Variable',
    family: 'Geist Mono',
  },
] as const;
const FONT_URL = /url\(\.\/files\/([a-z0-9-]+\.woff2)\)/g;
const COMMENT = /\/\*[\s\S]*?\*\/\n?/g;
const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

export const FONTS_DIRECTORY = 'fonts';

export function bundledFonts(): Map<string, Buffer> {
  const resolve = createRequire(import.meta.url).resolve;
  const files = new Map<string, Buffer>();
  const rules: string[] = [];
  for (const font of FONT_PACKAGES) {
    const published = readFileSync(resolve(`${font.name}/wght.css`), 'utf8');
    for (const [, file] of published.matchAll(FONT_URL)) {
      files.set(file!, readFileSync(resolve(`${font.name}/files/${file}`)));
    }
    rules.push(
      published
        .replace(COMMENT, '')
        .replaceAll(`'${font.published}'`, `'${font.family}'`)
        .replace(FONT_URL, 'url(./$1)')
        .trim(),
    );
    const slug = font.family.toLowerCase().replaceAll(' ', '-');
    files.set(`${slug}-OFL.txt`, readFileSync(resolve(`${font.name}/LICENSE`)));
  }
  files.set('fonts.css', Buffer.from(`${rules.join('\n\n')}\n`));
  return files;
}

export function bundledFontsPlugin(): Plugin {
  const files = bundledFonts();
  const route = new RegExp(`^/${FONTS_DIRECTORY}/([^/?]+)`);
  return {
    name: 'spark-bundled-fonts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = route.exec(req.url ?? '')?.[1];
        const body = name ? files.get(name) : undefined;
        if (!name || !body) {
          next();
          return;
        }
        res.setHeader('Content-Type', CONTENT_TYPES[name.split('.').pop()!]!);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },
    generateBundle() {
      for (const [name, source] of files) {
        this.emitFile({ type: 'asset', fileName: `${FONTS_DIRECTORY}/${name}`, source });
      }
    },
  };
}
