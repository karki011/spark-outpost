import { PASSCODE_LENGTH } from './crypto.ts';
import { documentPage, escapeHtml } from './pages.ts';
import type { ShareTheme } from './theme.ts';

const LOCK_TITLE = 'Locked page';

const LOCK_CSS = `
.lock {
  --pitch: min(46px, calc((100vw - 72px) / ${PASSCODE_LENGTH}));
  --tile: calc(var(--pitch) - 6px);
  --code-size: clamp(16px, calc(var(--pitch) * 0.5), 22px);
}
.lock .card { box-shadow: 0 0 60px color-mix(in srgb, var(--accent) 8%, transparent); }
.glyph { display: inline-grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px;
  border-radius: 14px; border: 1px solid var(--line); color: var(--accent); }
.glyph svg { width: 22px; height: 22px; }
.field { position: relative; width: calc(var(--pitch) * ${PASSCODE_LENGTH}); height: calc(var(--tile) + 8px); margin: 16px auto 8px; }
.boxes { position: absolute; inset: 0; display: flex; align-items: center; pointer-events: none; }
.boxes span {
  width: var(--tile);
  height: var(--tile);
  margin: 0 3px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.field:focus-within .boxes span { border-color: var(--accent); box-shadow: 0 0 10px var(--accent-glow); }
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
.field:focus-within { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 12px; }
.hint { font-size: 13px; }
.lock form button { width: 100%; margin-top: 8px; }
.error {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  color: var(--bad) !important;
  font-weight: 600;
}
.error svg { flex: none; width: 16px; height: 16px; }
.shake .boxes { animation: shake 0.4s ease-in-out; }
@keyframes shake {
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .shake .boxes { animation: none; }
  .boxes span { transition: none; }
}
`;

const VERIFIED_CSS = `
.verified .card { position: relative; overflow: hidden; }
.ok-title { color: var(--ok) !important; font-size: 22px; font-weight: 700; margin: 0 !important; }
.lead-out { position: absolute; left: 0; right: 0; top: 28px; margin: 0; font-size: 22px; font-weight: 700;
  animation: fade-out 0.25s ease 0.1s both; }
.stage { --ring: calc(var(--pitch) * 2.4); position: relative; width: calc(var(--ring) * 2 + var(--tile) + 24px);
  max-width: 100%; aspect-ratio: 1; margin: 8px auto; }
.track { position: absolute; left: 50%; top: 50%; width: calc(var(--ring) * 2); height: calc(var(--ring) * 2);
  margin: calc(var(--ring) * -1); border: 1px solid var(--line); border-radius: 50%;
  animation: track 1.3s ease both; }
.orbit { position: absolute; inset: 0; animation: orbit 0.7s cubic-bezier(0.45, 0, 0.55, 1) 0.4s both; }
.tile {
  position: absolute;
  left: 50%;
  top: 50%;
  display: grid;
  place-items: center;
  width: var(--tile);
  height: var(--tile);
  margin: calc(var(--tile) / -2);
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  color: var(--text);
  font: 600 var(--code-size)/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --x: calc((var(--i) - ${(PASSCODE_LENGTH - 1) / 2}) * var(--pitch));
  --a: calc(var(--i) * ${360 / PASSCODE_LENGTH}deg);
  --tilt: calc(var(--a) * -1 + 12deg);
  animation: tile 1.3s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.done { position: absolute; inset: 0; display: grid; place-items: center; }
.rings, .dots { position: absolute; inset: 0; }
.done .check {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border: 2px solid var(--ok);
  border-radius: 22px;
  background: var(--card);
  color: var(--ok);
  box-shadow: 0 0 28px var(--ok-glow);
  animation: pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) 1.05s backwards;
}
.done .check svg { width: 38px; height: 38px; }
.rings span {
  position: absolute;
  left: 50%;
  top: 50%;
  border: 1px solid var(--ok);
  opacity: 0.35;
  animation: ring 0.5s ease-out backwards;
}
.rings span:nth-child(1) { width: 104px; height: 104px; margin: -52px; border-radius: 30px; animation-delay: 1.1s; }
.rings span:nth-child(2) { width: 136px; height: 136px; margin: -68px; border-radius: 38px; opacity: 0.22; animation-delay: 1.17s; }
.rings span:nth-child(3) { width: 170px; height: 170px; margin: -85px; border-radius: 46px; opacity: 0.12; animation-delay: 1.24s; }
.dots span {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  margin: -2px;
  border-radius: 50%;
  background: var(--ok);
  opacity: 0.5;
  transform: rotate(var(--d)) translateY(-104px);
  animation: dot 0.5s ease-out 1.2s backwards;
}
.ok-sub { margin: 0 !important; animation: fade-in 0.3s ease 1.2s backwards; }
.ok-title { animation: fade-in 0.3s ease 1.15s backwards; }
.open { margin-top: 12px !important; font-size: 13px; visibility: hidden; animation: reveal 0s 4s forwards; }
@keyframes reveal { to { visibility: visible; } }
@keyframes fade-out { to { opacity: 0; } }
@keyframes fade-in { from { opacity: 0; transform: translateY(4px); } }
@keyframes track { 0% { opacity: 0; } 25%, 70% { opacity: 1; } 100% { opacity: 0; transform: scale(0.4); } }
@keyframes orbit { to { transform: rotate(360deg); } }
@keyframes tile {
  0% { transform: rotate(0deg) translate(var(--x), 0) rotate(0deg); }
  28% { transform: rotate(var(--a)) translate(0, calc(var(--ring) * -1)) rotate(var(--tilt));
    border-color: var(--line); color: var(--text); box-shadow: none; }
  55% { border-color: var(--ok); color: var(--ok); box-shadow: 0 0 14px var(--ok-glow); }
  78% { transform: rotate(var(--a)) translate(0, calc(var(--ring) * -1)) rotate(var(--tilt));
    border-color: var(--ok); color: var(--ok); box-shadow: 0 0 14px var(--ok-glow); opacity: 1; }
  100% { transform: rotate(calc(var(--a) + 200deg)) translate(0, 0) rotate(var(--tilt)) scale(0.3);
    border-color: var(--ok); color: var(--ok); opacity: 0; }
}
@keyframes pop { from { opacity: 0; transform: scale(0.3) rotate(-20deg); } }
@keyframes ring { from { opacity: 0; transform: scale(0.6); } }
@keyframes dot { from { opacity: 0; transform: rotate(var(--d)) translateY(-40px); } }
@media (prefers-reduced-motion: reduce) {
  .lead-out, .track, .orbit { display: none; }
  .done .check, .rings span, .dots span, .ok-title, .ok-sub { animation: none; }
}
`;

const LOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;

const ALERT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>`;

const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function boxes(): string {
  return Array.from({ length: PASSCODE_LENGTH }, () => '<span></span>').join('');
}

export function unlockPage(id: string, theme: ShareTheme | null, error?: string): string {
  const alert = error
    ? `<p class="error" id="code-error" role="alert">${ALERT_ICON}<span>${escapeHtml(error)}</span></p>`
    : '';
  const body = `<main class="center lock">
<div class="card">
<div class="glyph">${LOCK_ICON}</div>
<h1>This page is locked</h1>
<p>Enter the passcode you were sent.</p>
<form method="post" action="/a/${id}/unlock">
<label class="hint" for="code">Passcode, ${PASSCODE_LENGTH} letters and numbers</label>
<div class="field${error ? ' shake' : ''}">
<div class="boxes" aria-hidden="true">${boxes()}</div>
<input id="code" name="code" type="text" maxlength="${PASSCODE_LENGTH + 1}" pattern="[\\s\\-]*([A-Za-z0-9][\\s\\-]*){${PASSCODE_LENGTH}}" title="${PASSCODE_LENGTH} letters and numbers" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" required${error ? ' aria-invalid="true" aria-describedby="code-error"' : ''}>
</div>
${alert}
<button type="submit">Unlock</button>
</form>
</div>
</main>`;
  return documentPage(LOCK_TITLE, body, { css: LOCK_CSS, theme });
}

export function wrongCodePage(id: string, theme: ShareTheme | null): string {
  return unlockPage(id, theme, 'That code didn’t work. Check it and try again.');
}

export function lockedOutPage(id: string, minutes: number, theme: ShareTheme | null): string {
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return unlockPage(id, theme, `Too many wrong codes. Try again in about ${minutes} ${unit}.`);
}

function tiles(code: string): string {
  return [...code]
    .map(
      (character, index) =>
        `<span class="tile" style="--i: ${index}">${escapeHtml(character)}</span>`,
    )
    .join('');
}

function dots(): string {
  return Array.from(
    { length: 12 },
    (_, index) => `<span style="--d: ${index * 30 + 15}deg"></span>`,
  ).join('');
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
<div class="card">
<p class="lead-out" aria-hidden="true">This page is locked</p>
<div role="status">
<p class="ok-title">Verified.</p>
<div class="stage" aria-hidden="true">
<div class="track"></div>
<div class="orbit">${tiles(code)}</div>
<div class="done"><div class="rings"><span></span><span></span><span></span></div><div class="dots">${dots()}</div><div class="check">${CHECK_ICON}</div></div>
</div>
<p class="ok-sub">You’re in.</p>
</div>
<p class="open"><a href="${target}">Open the page</a></p>
</div>
</main>`;
  return documentPage(LOCK_TITLE, body, { css: LOCK_CSS + VERIFIED_CSS, head, theme });
}
