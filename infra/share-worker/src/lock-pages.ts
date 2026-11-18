import { PASSCODE_LENGTH } from './crypto.ts';
import { documentPage, escapeHtml } from './pages.ts';
import { scout, SCOUT_CSS, type ScoutPose } from './scout.ts';
import type { ShareTheme } from './theme.ts';

const LOCK_TITLE = 'Locked page';
const CODE_INPUT_MAX = PASSCODE_LENGTH + 4;

const LOCK_CSS = `
.lock {
  --pitch: min(46px, calc((100vw - 48px) / ${PASSCODE_LENGTH}));
  --tile: calc(var(--pitch) - 6px);
  --tile-height: calc(var(--tile) + 8px);
  --code-size: clamp(16px, calc(var(--pitch) * 0.5), 22px);
  padding: 24px 12px;
  overflow-x: clip;
}
.screen { display: flex; flex-direction: column; align-items: center; width: min(100%, 392px); text-align: center; }
.screen h1, .heading p { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--text); }
.line { margin: 6px 0 22px; font-size: 14px; color: var(--muted); }
.lock form { display: flex; flex-direction: column; align-items: center; width: 100%; }
.hint { margin-bottom: 10px; font-size: 13px; font-weight: 500; color: var(--text); }
.field { position: relative; width: calc(var(--pitch) * ${PASSCODE_LENGTH}); height: var(--tile-height); }
.boxes { position: absolute; inset: 0; display: flex; align-items: center; pointer-events: none; }
.boxes span, .tile {
  flex: none;
  width: var(--tile);
  height: var(--tile-height);
  margin: 0 3px;
  border: 1px solid color-mix(in srgb, var(--line), var(--muted));
  border-radius: 10px;
  background: var(--bg);
}
.boxes span { transition: border-color 0.2s; }
.field:focus-within .boxes span { border-color: var(--accent); }
.field.bad .boxes span { border-color: var(--bad); }
.field input {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(100% + var(--pitch));
  height: 100%;
  padding: 0 0 0 calc((var(--pitch) - 1ch) / 2);
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  caret-color: var(--accent);
  font: 600 var(--code-size)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: calc(var(--pitch) - 1ch);
  text-transform: uppercase;
}
.field input:focus { outline: none; }
.field input:valid { caret-color: transparent; }
.field:focus-within { outline: 2px solid var(--accent); outline-offset: 5px; border-radius: 12px; }
.field.bad:focus-within { outline-color: var(--bad); }
.error { margin: 10px 0 0; font-size: 13px; font-weight: 600; color: var(--bad); text-wrap: balance; }
.error svg { width: 15px; height: 15px; margin-right: 6px; vertical-align: -3px; }
.lock form button { width: calc(var(--pitch) * ${PASSCODE_LENGTH} - 6px); margin-top: 20px; }
.shake .boxes { animation: shake 0.36s ease-out; }
@keyframes shake {
  20% { transform: translateX(-8px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake .boxes { animation: none; }
  .boxes span { transition: none; }
}
`;

const VERIFIED_CSS = `
.heading { display: grid; }
.heading > * { grid-area: 1 / 1; }
.heading .lead-out { animation: fade-out 0.2s ease 0.3s both; }
.heading .ok-title { color: var(--ok); animation: fade-in 0.3s ease 0.45s backwards; }
.ok-sub { animation: fade-in 0.3s ease 0.5s backwards; }
.tiles { display: flex; justify-content: center; }
.tile {
  display: grid;
  place-items: center;
  border-color: var(--ok);
  color: var(--text);
  font: 600 var(--code-size)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  animation: tile 0.3s ease calc(0.35s + var(--i) * 40ms) backwards;
}
.open { min-height: 44px; margin: 16px 0 0; font-size: 13px; line-height: 44px; visibility: hidden; animation: reveal 0s 4s forwards; }
@keyframes reveal { to { visibility: visible; } }
@keyframes fade-out { to { opacity: 0; } }
@keyframes fade-in { from { opacity: 0; transform: translateY(4px); } }
@keyframes tile { from { border-color: color-mix(in srgb, var(--line), var(--muted)); } 50% { transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) {
  .heading .lead-out { display: none; }
  .heading .ok-title, .ok-sub, .tile { animation: none; }
}
`;

const ALERT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>`;

interface Problem {
  text: string;
  pose: ScoutPose;
}

function boxes(): string {
  return Array.from({ length: PASSCODE_LENGTH }, () => '<span></span>').join('');
}

function entryPage(id: string, theme: ShareTheme | null, problem?: Problem): string {
  const alert = problem
    ? `<p class="error" id="code-error" role="alert">${ALERT_ICON}<span>${escapeHtml(problem.text)}</span></p>`
    : '';
  const field = problem ? `field bad${problem.pose === 'no' ? ' shake' : ''}` : 'field';
  const body = `<main class="center lock">
<div class="screen">
${scout(problem?.pose ?? 'asleep')}
<h1>This page is locked</h1>
<p class="line">Enter the passcode you were sent.</p>
<form method="post" action="/a/${id}/unlock">
<label class="hint" for="code">Passcode, ${PASSCODE_LENGTH} letters and numbers</label>
<div class="${field}">
<div class="boxes" aria-hidden="true">${boxes()}</div>
<input id="code" name="code" type="text" maxlength="${CODE_INPUT_MAX}" pattern="[\\s\\-]*([A-Za-z0-9][\\s\\-]*){${PASSCODE_LENGTH}}" title="${PASSCODE_LENGTH} letters and numbers" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder=" " required${problem ? ' aria-invalid="true" aria-describedby="code-error"' : ''}>
</div>
${alert}
<button type="submit">Unlock</button>
</form>
</div>
</main>`;
  return documentPage(LOCK_TITLE, body, { css: LOCK_CSS + SCOUT_CSS, theme });
}

export function unlockPage(id: string, theme: ShareTheme | null): string {
  return entryPage(id, theme);
}

export function wrongCodePage(id: string, theme: ShareTheme | null): string {
  return entryPage(id, theme, {
    text: 'That code didn’t work. Check it and try again.',
    pose: 'no',
  });
}

export function lockedOutPage(id: string, minutes: number, theme: ShareTheme | null): string {
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return entryPage(id, theme, {
    text: `Too many wrong codes. Try again in about ${minutes} ${unit}.`,
    pose: 'sulk',
  });
}

function tiles(code: string): string {
  return [...code]
    .map(
      (character, index) =>
        `<span class="tile" style="--i: ${index}">${escapeHtml(character)}</span>`,
    )
    .join('');
}

export function verifiedPage(
  id: string,
  code: string,
  refreshSeconds: number,
  theme: ShareTheme | null,
): string {
  const target = `/a/${id}`;
  const head = `<meta http-equiv="refresh" content="${refreshSeconds};url=${target}">\n`;
  const body = `<main class="center lock verified">
<div class="screen">
${scout('happy')}
<div role="status">
<div class="heading">
<p class="lead-out" aria-hidden="true">This page is locked</p>
<p class="ok-title">Verified.</p>
</div>
<p class="line ok-sub">You’re in.</p>
</div>
<div class="tiles" aria-hidden="true">${tiles(code)}</div>
<p class="open"><a href="${target}">Open the page</a></p>
</div>
</main>`;
  return documentPage(LOCK_TITLE, body, {
    css: LOCK_CSS + SCOUT_CSS + VERIFIED_CSS,
    head,
    theme,
  });
}
