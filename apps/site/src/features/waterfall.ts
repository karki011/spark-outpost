import { button, el, frame } from '../dom.ts';
import { onceVisible } from '../motion.ts';

interface Request {
  method: string;
  path: string;
  status: number;
  start: number;
  end: number;
  race?: boolean;
}

const TOTAL_MS = 900;
const PLAY_MS = 2600;

const REQUESTS: Request[] = [
  { method: 'GET', path: '/checkout', status: 200, start: 0, end: 120 },
  { method: 'GET', path: '/assets/app.js', status: 200, start: 40, end: 260 },
  { method: 'GET', path: '/api/cart', status: 200, start: 180, end: 760, race: true },
  { method: 'GET', path: '/api/prices', status: 200, start: 200, end: 420 },
  { method: 'POST', path: '/api/order', status: 409, start: 430, end: 560, race: true },
];

function requestRow(request: Request): { row: HTMLElement; bar: HTMLElement } {
  const row = el(
    'li',
    `request${request.race ? ' race' : ''}${request.status >= 400 ? ' failed' : ''}`,
  );
  const track = el('span', 'track');
  const bar = el('span', 'bar');
  bar.style.left = `${(request.start / TOTAL_MS) * 100}%`;
  track.append(bar);
  row.append(
    el('span', 'method', request.method),
    el('span', 'path', request.path),
    el('span', 'status', String(request.status)),
    track,
  );
  return { row, bar };
}

export function mountWaterfall(host: HTMLElement, still: boolean): void {
  const { root, body } = frame('localhost:5173/checkout');
  root.classList.add('browser');

  const page = el('div', 'page');
  const toast = el('p', 'toast', 'Something went wrong placing your order.');
  page.append(
    el('span', 'page-line wide'),
    el('span', 'page-line'),
    el('span', 'page-cta', 'Place order'),
    toast,
  );

  const panel = el('div', 'devtools');
  const tabs = el('div', 'devtools-tabs');
  tabs.append(
    el('span', 'on', 'Network'),
    el('span', '', 'Console'),
    el('span', '', 'Performance'),
  );
  const list = el('ol', 'requests');
  const rows = REQUESTS.map((request) => {
    const made = requestRow(request);
    list.append(made.row);
    return { request, ...made };
  });
  const consoleLine = el(
    'p',
    'console-line',
    'TypeError: cart.items is undefined  at placeOrder (cart.ts:42)',
  );
  const note = el(
    'p',
    'agent-note',
    'Agent: POST /api/order starts before GET /api/cart finishes. Waiting for the cart fixes it.',
  );
  panel.append(tabs, list, consoleLine);
  body.append(page, panel);

  const replay = button('replay', 'Replay requests', () => play());
  host.append(root, note, replay);

  const draw = (now: number) => {
    for (const { request, row, bar } of rows) {
      const reached = Math.max(0, Math.min(now, request.end) - request.start);
      bar.style.width = `${(reached / TOTAL_MS) * 100}%`;
      row.classList.toggle('live', now >= request.start && now < request.end);
      row.classList.toggle('done', now >= request.end);
    }
    const ended = now >= TOTAL_MS;
    toast.classList.toggle('on', now >= 560);
    consoleLine.classList.toggle('on', now >= 560);
    note.classList.toggle('on', ended);
    host.classList.toggle('overlap', now >= 430 && now <= 760);
    replay.hidden = still || !ended;
  };

  let started = 0;
  const tick = (time: number) => {
    const now = Math.min(TOTAL_MS, ((time - started) / PLAY_MS) * TOTAL_MS);
    draw(now);
    if (now < TOTAL_MS) requestAnimationFrame(tick);
  };
  const play = () => {
    started = performance.now();
    requestAnimationFrame(tick);
  };

  draw(still ? TOTAL_MS : 0);
  if (!still) onceVisible(host, play);
}
