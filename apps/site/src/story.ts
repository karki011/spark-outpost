import { el } from './dom.ts';

function chapterLink(chapter: HTMLElement, index: number): HTMLAnchorElement {
  const link = el('a', 'story-link');
  link.href = `#${chapter.id}`;
  link.append(
    el('span', 'story-number', String(index + 1).padStart(2, '0')),
    el('span', 'story-name', chapter.dataset.chapter ?? ''),
  );
  return link;
}

export function mountStory(): void {
  const story = document.querySelector<HTMLElement>('[data-story]');
  if (!story) return;
  const chapters = [...story.querySelectorAll<HTMLElement>('[data-chapter]')];
  const rail = el('nav', 'story-rail');
  rail.setAttribute('aria-label', 'Features');
  const links = chapters.map(chapterLink);
  rail.append(...links);
  story.prepend(rail);
  chapters.forEach((chapter, index) => {
    chapter
      .querySelector('.chapter-copy')
      ?.prepend(
        el(
          'span',
          'chapter-number',
          `${String(index + 1).padStart(2, '0')} / ${String(chapters.length).padStart(2, '0')}`,
        ),
      );
  });

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const current = chapters.indexOf(entry.target as HTMLElement);
        links.forEach((link, index) => {
          if (index === current) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  for (const chapter of chapters) observer.observe(chapter);
}
