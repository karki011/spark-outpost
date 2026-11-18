import { themeCss, type ShareTheme } from './theme.ts';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f7;
  --card: #ffffff;
  --text: #1c1d21;
  --muted: #555b66;
  --line: #d5d8de;
  --accent: #2459c9;
  --accent-glow: rgba(36, 89, 201, 0.28);
  --ok: #17733a;
  --ok-glow: rgba(23, 115, 58, 0.3);
  --bad: #b3261e;
  --strip: #ebedf1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e0f12;
    --card: #17191e;
    --text: #eceef2;
    --muted: #a3a9b4;
    --line: #353a44;
    --accent: #7aa7ff;
    --accent-glow: rgba(122, 167, 255, 0.35);
    --ok: #4cc77a;
    --ok-glow: rgba(76, 199, 122, 0.4);
    --bad: #ff8a80;
    --strip: #1b1d22;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button {
  min-height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-ink, var(--card));
  font: 600 15px/1 inherit;
  font-family: inherit;
  cursor: pointer;
}
.center {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 16px 12px;
}
.card {
  width: min(100%, 420px);
  padding: 28px 20px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--card);
  text-align: center;
}
.card h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; }
.card p { margin: 0 0 12px; color: var(--muted); }
`;

const SHELL_CSS = `
body.viewer { display: flex; flex-direction: column; height: 100dvh; }
.strip {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--strip);
  font-size: 13px;
}
.strip p { flex: 1 1 auto; margin: 0; color: var(--muted); min-width: 0; }
.strip strong { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
.strip summary {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--accent);
  cursor: pointer;
  list-style: none;
}
.strip summary::-webkit-details-marker { display: none; }
.strip form {
  position: absolute;
  right: 12px;
  top: calc(100% + 4px);
  z-index: 1;
  display: grid;
  gap: 8px;
  width: min(320px, calc(100vw - 24px));
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}
.strip label { font-size: 13px; color: var(--text); }
.strip textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.4 inherit;
  font-family: inherit;
  resize: vertical;
}
iframe { flex: 1 1 auto; width: 100%; border: 0; background: #ffffff; }
`;

export function documentPage(title: string, body: string, options: PageOptions = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
${options.head ?? ''}<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${themeCss(options.theme)}${options.css ?? ''}</style>
</head>
<body${options.bodyClass ? ` class="${options.bodyClass}"` : ''}>
${body}
</body>
</html>
`;
}

interface PageOptions {
  css?: string;
  head?: string;
  bodyClass?: string;
  theme?: ShareTheme | null;
}

export function messagePage(
  title: string,
  heading: string,
  text: string,
  link?: string,
  theme: ShareTheme | null = null,
) {
  const back = link ? `<p><a href="${escapeHtml(link)}">Back to the page</a></p>` : '';
  return documentPage(
    title,
    `<main class="center"><div class="card"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p>${back}</div></main>`,
    { theme },
  );
}

export const notFoundPage = () =>
  messagePage(
    'Not found',
    'This link doesn’t work',
    'The page was removed, expired or never existed.',
  );

export const unavailablePage = () =>
  messagePage(
    'Unavailable',
    'Not available right now',
    'Shared pages can’t be shown at the moment. Try again later.',
  );

export const badRequestPage = () =>
  messagePage('Bad request', 'That didn’t work', 'The request wasn’t understood.');

export const methodPage = () =>
  messagePage('Not allowed', 'Not allowed', 'This address doesn’t accept that kind of request.');

export const thanksPage = (id: string, theme: ShareTheme | null) =>
  messagePage('Thanks', 'Thanks for the report', 'We’ll look at this page.', `/a/${id}`, theme);

export const tooManyReportsPage = () =>
  messagePage('Try later', 'Too many reports', 'Wait a while before sending another report.');

export function shellPage(
  id: string,
  title: string,
  contentSrc: string,
  theme: ShareTheme | null,
): string {
  const safeTitle = escapeHtml(title);
  const body = `<header class="strip">
<p><strong>${safeTitle}</strong> · Shared from Spark Outpost · made by a user, not checked</p>
<details>
<summary>Report</summary>
<form method="post" action="/a/${id}/report">
<label for="reason">What’s wrong with this page? (optional)</label>
<textarea id="reason" name="reason" maxlength="500" rows="3"></textarea>
<button type="submit">Send report</button>
</form>
</details>
</header>
<iframe title="${safeTitle}" src="${escapeHtml(contentSrc)}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>`;
  return documentPage(title, body, { css: SHELL_CSS, bodyClass: 'viewer', theme });
}
