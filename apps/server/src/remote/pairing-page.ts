import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { REMOTE_DEVICE_NAME_MAX } from '@spark-outpost/contracts';

const POLL_MS = 2000;

const STYLES = `
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--bg); color: var(--text);
    font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { width: min(22rem, calc(100vw - 2rem)); padding: 1.5rem; box-sizing: border-box;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { margin: 0 0 1rem; color: var(--muted); }
  label { display: block; margin: 0 0 0.25rem; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; margin: 0 0 1rem; padding: 0.625rem 0.75rem;
    font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line-strong); border-radius: var(--r-sm); }
  button { width: 100%; padding: 0.75rem; font: inherit; font-weight: 600; cursor: pointer;
    color: var(--accent-ink); background: var(--accent); border: 0; border-radius: var(--r-sm); }
  button:disabled { opacity: 0.6; cursor: default; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  .match { font-size: 2rem; font-weight: 700; letter-spacing: 0.08em; text-align: center;
    color: var(--text); }
  #status { min-height: 1.5rem; margin: 1rem 0 0; }
  #status[data-kind="error"] { color: var(--danger); }
`;

const SCRIPT = `
  const form = document.getElementById('pair');
  const wait = document.getElementById('wait');
  const status = document.getElementById('status');
  const code = document.getElementById('code');
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('code');
  if (fromLink) {
    code.value = fromLink;
    history.replaceState(null, '', location.pathname);
  }
  const say = (text, kind) => {
    status.textContent = text;
    status.dataset.kind = kind || '';
  };
  const post = (path, body) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const failed = async (response) => {
    const body = await response.json().catch(() => ({}));
    form.hidden = false;
    wait.hidden = true;
    form.querySelector('button').disabled = false;
    say(body.error || 'Pairing did not work. Try again.', 'error');
  };
  const poll = async (claim) => {
    const response = await post('/api/remote/pair/claim', { claim }).catch(() => null);
    if (response && response.ok) {
      const body = await response.json();
      if (body.status === 'paired') {
        location.replace('/');
        return;
      }
    } else if (response) {
      await failed(response);
      return;
    }
    setTimeout(() => poll(claim), ${POLL_MS});
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelector('button').disabled = true;
    say('Checking the code…');
    const response = await post('/api/remote/pair', {
      code: code.value,
      deviceName: document.getElementById('name').value,
    }).catch(() => null);
    if (!response) {
      form.querySelector('button').disabled = false;
      say('Your Mac did not answer. Try again.', 'error');
      return;
    }
    if (!response.ok) {
      await failed(response);
      return;
    }
    const body = await response.json();
    document.getElementById('match').textContent = body.matchCode;
    form.hidden = true;
    wait.hidden = false;
    say('Waiting for you to confirm on your Mac…');
    poll(body.claim);
  });
`;

function page(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pair with Spark Outpost</title>
<link rel="stylesheet" href="/theme.css">
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<main>
<h1>Pair this device</h1>
<form id="pair">
<p>Start pairing in Spark Outpost on your Mac, then type the code it shows.</p>
<label for="code">Pairing code</label>
<input id="code" name="code" required maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false">
<label for="name">Device name</label>
<input id="name" name="name" required maxlength="${REMOTE_DEVICE_NAME_MAX}" autocomplete="off" placeholder="My phone">
<button type="submit">Pair</button>
</form>
<section id="wait" hidden>
<p>Check that your Mac shows this code, then confirm there.</p>
<p class="match" id="match"></p>
</section>
<p id="status" role="status" aria-live="polite"></p>
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

export function sendPairingPage(res: Response): void {
  const nonce = randomBytes(16).toString('base64');
  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; style-src 'self' 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    })
    .send(page(nonce));
}
