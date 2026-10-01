import { loadGuidePages, type GuidePage } from '@spark-outpost/contracts';

const sources = import.meta.glob<string>('../../../../docs/guide/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const images = import.meta.glob<string>('../../../../docs/guide/images/*.{png,jpg,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const guidePages: GuidePage[] = loadGuidePages(sources);

const imageUrls = new Map(
  Object.entries(images).map(([file, url]) => [file.slice(file.indexOf('images/')), url]),
);

export type ColorScheme = 'light' | 'dark';

export function guideImage(src: string, scheme: ColorScheme): string | null {
  const path = src.replace(/^\.\//, '');
  const themed = path.replace(/-(light|dark)(\.\w+)$/, `-${scheme}$2`);
  return imageUrls.get(themed) ?? imageUrls.get(path) ?? null;
}
