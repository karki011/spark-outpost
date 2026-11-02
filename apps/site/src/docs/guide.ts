import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { guideBodyWithoutNext, loadGuidePages } from '@spark-outpost/contracts';
import { fillDocTemplate, docMainHtml } from './layout.ts';
import { renderGuideBody, type GuideImage } from './render.ts';
import { docFile } from './urls.ts';

export const GUIDE_DIR = resolve(import.meta.dirname, '../../../../docs/guide');
export const GUIDE_IMAGES = resolve(GUIDE_DIR, 'images');

export interface BuiltDocs {
  pages: Map<string, string>;
  images: string[];
}

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function existing(file: string): string | null {
  return existsSync(resolve(GUIDE_IMAGES, file)) ? file : null;
}

function guideImage(src: string): GuideImage | null {
  const match = /^(?:\.\/)?images\/([\w-]+\.png)$/.exec(src);
  if (!match) return null;
  const file = match[1]!;
  const variant = (scheme: string) =>
    existing(file.replace(/-(light|dark)\.png$/, `-${scheme}.png`));
  const light = variant('light') ?? existing(file);
  if (!light) return null;
  const dark = variant('dark');
  return {
    light,
    dark: dark === light ? null : dark,
    ...pngSize(readFileSync(resolve(GUIDE_IMAGES, light))),
  };
}

export function buildDocs(template: string): BuiltDocs {
  const sources = Object.fromEntries(
    readdirSync(GUIDE_DIR)
      .filter((file) => file.endsWith('.md'))
      .map((file) => [file, readFileSync(resolve(GUIDE_DIR, file), 'utf8')]),
  );
  const pages = loadGuidePages(sources);
  const slugs = new Set(pages.map((page) => page.slug));
  const built = new Map<string, string>();
  const images = new Set<string>();
  const problems: string[] = [];
  for (const page of pages) {
    const body = renderGuideBody(guideBodyWithoutNext(page), {
      slug: page.slug,
      slugs,
      image: guideImage,
    });
    problems.push(...body.problems);
    body.images.forEach((image) => images.add(image));
    built.set(
      docFile(page.slug),
      fillDocTemplate(template, page, docMainHtml(pages, page, body.html)),
    );
  }
  if (problems.length > 0) throw new Error(`The user guide has problems:\n${problems.join('\n')}`);
  return { pages: built, images: [...images] };
}
