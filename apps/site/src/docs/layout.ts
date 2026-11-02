import {
  GUIDE_TYPE_LABELS,
  groupGuideSections,
  guideNeighbours,
  type GuidePage,
} from '@spark-outpost/contracts';
import { escapeHtml } from '../changelog/changelog.ts';
import { docHref } from './urls.ts';

const TITLE = '<title>Docs · Spark Outpost</title>';
const DESCRIPTION = '<meta name="description" content="Spark Outpost user guide." />';
const MAIN = '<main id="main" class="docs wrap" data-docs></main>';

function sidebarHtml(pages: readonly GuidePage[], current: GuidePage): string {
  const sections = groupGuideSections(pages).map(({ section, pages: entries }) => {
    const items = entries.map((entry) => {
      const currentMark = entry.slug === current.slug ? ' aria-current="page"' : '';
      const soon = entry.comingSoon ? ' <span class="docs-soon">Soon</span>' : '';
      return `<li><a href="${docHref(entry.slug)}"${currentMark}>${escapeHtml(entry.title)}</a>${soon}</li>`;
    });
    return `<li><p class="docs-section">${escapeHtml(section)}</p><ul>${items.join('')}</ul></li>`;
  });
  return `<nav id="docs-nav" class="docs-nav" aria-label="Guide pages"><ul>${sections.join('')}</ul></nav>`;
}

function pagerLink(page: GuidePage | null, rel: 'prev' | 'next'): string {
  if (!page) return '';
  const label = rel === 'prev' ? 'Previous' : 'Next';
  return `<a class="docs-pager-${rel}" href="${docHref(page.slug)}" rel="${rel}"><span>${label}</span>${escapeHtml(page.title)}</a>`;
}

function headHtml(page: GuidePage): string {
  const typeLabel = GUIDE_TYPE_LABELS[page.type];
  const section = page.section === typeLabel ? '' : escapeHtml(page.section);
  return [
    '<header class="docs-head">',
    `<p class="docs-crumb"><span class="docs-type" data-type="${page.type}">${typeLabel}</span>${section}</p>`,
    `<h1>${escapeHtml(page.title)}</h1>`,
    `<p class="docs-lede">${escapeHtml(page.summary)}</p>`,
    '<a class="docs-jump" href="#docs-nav">All pages</a>',
    '</header>',
  ].join('');
}

export function docMainHtml(pages: readonly GuidePage[], page: GuidePage, body: string): string {
  const { previous, next } = guideNeighbours(pages, page);
  const pager =
    previous || next
      ? `<nav class="docs-pager" aria-label="More pages">${pagerLink(previous, 'prev')}${pagerLink(next, 'next')}</nav>`
      : '';
  return [
    `<article class="docs-article" data-page="${page.slug}">`,
    headHtml(page),
    `<div class="docs-body">${body}</div>`,
    pager,
    '</article>',
    sidebarHtml(pages, page),
  ].join('');
}

function replaceOnce(html: string, slot: string, value: string): string {
  if (!html.includes(slot)) throw new Error(`Docs template is missing ${slot}`);
  return html.replace(slot, () => value);
}

export function fillDocTemplate(template: string, page: GuidePage, main: string): string {
  const title = `<title>${escapeHtml(page.title)} · Spark Outpost docs</title>`;
  const description = `<meta name="description" content="${escapeHtml(page.summary)}" />`;
  const withHead = replaceOnce(replaceOnce(template, TITLE, title), DESCRIPTION, description);
  return replaceOnce(withHead, MAIN, MAIN.replace('></main>', `>${main}</main>`));
}
