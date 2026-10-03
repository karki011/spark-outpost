import {
  GUIDE_REDIRECTS,
  guideNextSlug,
  loadGuidePages,
  resolveGuideLink,
  type GuideLink,
  type GuidePage,
} from '@spark-outpost/contracts';

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

const bySlug = new Map(guidePages.map((page) => [page.slug, page]));

export interface OpenDoc {
  page: GuidePage;
  anchor: string | null;
  previous: GuidePage | null;
  next: GuidePage | null;
}

function neighbours(page: GuidePage): Pick<OpenDoc, 'previous' | 'next'> {
  const section = guidePages.filter((entry) => entry.section === page.section);
  const index = section.indexOf(page);
  const nextSlug = guideNextSlug(page);
  return {
    previous:
      guidePages.find((entry) => guideNextSlug(entry) === page.slug) ?? section[index - 1] ?? null,
    next: (nextSlug ? bySlug.get(nextSlug) : section[index + 1]) ?? null,
  };
}

export function openDocFor(route: GuideLink | null): OpenDoc | null {
  const target = route?.slug ? resolveGuideLink(guidePages, GUIDE_REDIRECTS, route) : null;
  const page = (target && bySlug.get(target.slug)) ?? guidePages[0];
  if (!page) return null;
  return { page, anchor: target?.slug === page.slug ? target.anchor : null, ...neighbours(page) };
}

const imageUrls = new Map(
  Object.entries(images).map(([file, url]) => [file.slice(file.indexOf('images/')), url]),
);

export type ColorScheme = 'light' | 'dark';

export function guideImage(src: string, scheme: ColorScheme): string | null {
  const path = src.replace(/^\.\//, '');
  const themed = path.replace(/-(light|dark)(\.\w+)$/, `-${scheme}$2`);
  return imageUrls.get(themed) ?? imageUrls.get(path) ?? null;
}
