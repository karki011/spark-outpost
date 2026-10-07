import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import {
  PAIRING_CODE_LENGTH,
  REMOTE_DEVICE_NAME_MAX,
  SCOUT_ANTENNA,
  SCOUT_BODY,
  SCOUT_SPARK,
} from '@spark-outpost/contracts';
import { PAIRING_PAGE_STYLES } from './pairing-page-styles.ts';

const POLL_MS = 2000;
const PAIRED_MOMENT_MS = 1200;

const BLOB = `
<svg class="blob" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
<g class="hop"><g class="body">
<path class="ant" d="${SCOUT_ANTENNA}" fill="none" stroke-width="3" stroke-linecap="round"/>
<path class="spark" d="${SCOUT_SPARK}"/>
<path class="skin" d="${SCOUT_BODY}"/>
<circle class="cheek" cx="18.5" cy="46.5" r="2.7"/>
<circle class="cheek" cx="45.5" cy="46.5" r="2.7"/>
<g class="look">
<rect class="eye" x="22.5" y="32" width="5.6" height="11" rx="2.8"/>
<rect class="eye" x="35.9" y="32" width="5.6" height="11" rx="2.8"/>
<path class="smile" d="M22.4 40.5Q25.3 34.5 28.2 40.5M35.8 40.5Q38.7 34.5 41.6 40.5"/>
</g></g></g>
</svg>`;

const THEME_KEY = 'spark-outpost.theme';
const DEFAULT_SKIN = 'graphite';

const THEME_SCRIPT = `
  try {
    const saved = localStorage.getItem('${THEME_KEY}') || '${DEFAULT_SKIN}';
    if (saved !== 'system' && /^[a-z]+$/.test(saved)) document.documentElement.dataset.skin = saved;
  } catch {
    document.documentElement.dataset.skin = '${DEFAULT_SKIN}';
  }
`;

const SCRIPT = `
  const main = document.querySelector('main');
  const form = document.getElementById('pair');
  const wait = document.getElementById('wait');
  const done = document.getElementById('done');
  const retry = document.getElementById('retry');
  const show = (stage) => {
    main.dataset.stage = stage;
    form.hidden = stage !== 'enter';
    wait.hidden = stage !== 'waiting';
    done.hidden = stage !== 'paired';
    retry.hidden = stage !== 'ended';
  };
  const status = document.getElementById('status');
  const code = document.getElementById('code');
  const name = document.getElementById('name');
  const grouped = (text) =>
    (text.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, ${PAIRING_CODE_LENGTH}).match(/.{1,4}/g) || [])
      .join('-');
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('code');
  if (fromLink) {
    code.value = grouped(fromLink);
    history.replaceState(null, '', location.pathname);
    name.focus();
  } else if (location.search) history.replaceState(null, '', location.pathname);
  code.addEventListener('input', () => {
    code.removeAttribute('aria-invalid');
    if (code.selectionStart === code.value.length) code.value = grouped(code.value);
  });
  code.addEventListener('blur', () => {
    code.value = grouped(code.value);
  });
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
    form.querySelector('button').disabled = false;
    show('ended');
    say(body.error || 'Pairing did not work. Try again.', 'error');
    retry.focus();
  };
  const poll = async (claim) => {
    const response = await post('/api/remote/pair/claim', { claim }).catch(() => null);
    if (response && response.ok) {
      const body = await response.json();
      if (body.status === 'paired') {
        show('paired');
        say('Paired. Opening Spark Outpost…');
        setTimeout(() => location.replace('/'), ${PAIRED_MOMENT_MS});
        return;
      }
    } else if (response) {
      await failed(response);
      return;
    }
    setTimeout(() => poll(claim), ${POLL_MS});
  };
  retry.addEventListener('click', () => {
    code.value = '';
    show('enter');
    say('');
    code.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelector('button').disabled = true;
    say('Checking the code…');
    const response = await post('/api/remote/pair', {
      code: code.value,
      deviceName: name.value,
    }).catch(() => null);
    if (!response) {
      form.querySelector('button').disabled = false;
      say('Your Mac did not answer. Try again.', 'error');
      return;
    }
    if (!response.ok) {
      const refused = await response.json().catch(() => ({}));
      form.querySelector('button').disabled = false;
      code.setAttribute('aria-invalid', 'true');
      say(refused.error || 'Pairing did not work. Try again.', 'error');
      code.focus();
      code.select();
      return;
    }
    const body = await response.json();
    document.getElementById('match').textContent = body.matchCode;
    show('waiting');
    say('Waiting for you to confirm on your Mac…');
    poll(body.claim);
  });
`;

function page(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Pair with Spark Outpost</title>
<link rel="stylesheet" href="/theme.css">
<script nonce="${nonce}">${THEME_SCRIPT}</script>
<style nonce="${nonce}">${PAIRING_PAGE_STYLES}</style>
</head>
<body>
<main data-stage="enter">
<div class="scene">${BLOB}<i class="shadow"></i></div>
<h1>Pair this device</h1>
<form id="pair">
<p>Start pairing in Spark Outpost on your Mac, then type the code it shows.</p>
<label for="code">Pairing code</label>
<input id="code" name="code" required maxlength="40" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-describedby="status" placeholder="XXXX-XXXX-XXXX">
<label for="name">Device name</label>
<input id="name" name="name" required maxlength="${REMOTE_DEVICE_NAME_MAX}" autocomplete="off" autocapitalize="words" enterkeyhint="go" placeholder="My phone">
<button type="submit">Pair</button>
</form>
<section id="wait" hidden>
<p>Confirm on your Mac. It should show this code.</p>
<p class="match" id="match"></p>
</section>
<section id="done" hidden>
<p>This device is paired.</p>
</section>
<button type="button" id="retry" hidden>Try again</button>
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
