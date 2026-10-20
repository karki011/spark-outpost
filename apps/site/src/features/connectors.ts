import { button, el } from '../dom.ts';
import { onVisibility } from '../motion.ts';

const CONNECTORS = [
  {
    name: 'GitHub',
    text: 'Agents open pull requests; Spark shows their checks, reviews and comments.',
  },
  {
    name: 'Jira',
    text: 'Start a chat from a ticket. It moves to In review when the PR opens, Done when it merges.',
  },
  {
    name: 'Confluence',
    text: 'Agents search and read pages, and update them following your mode.',
  },
  { name: 'Linear', text: 'Tickets in the inbox, kept in step with your pull requests.' },
  { name: 'Slack', text: 'Pick the channels Spark may use. Signed in as you, posts always ask.' },
  {
    name: 'MCP servers',
    text: 'Add a server in Spark and its tools go through the approval gate.',
  },
  {
    name: 'Google Calendar',
    text: 'See your day and join meetings; agents read it only if you allow.',
  },
  { name: 'Mac Calendar', text: 'Every calendar synced to your Mac, read on your Mac.' },
];

const SPEED = 0.00012;

export function mountConnectors(host: HTMLElement, still: boolean): void {
  const ring = el('div', 'orbit');
  const hub = el('div', 'orbit-hub');
  const scout = el('img');
  scout.src = '/scout.svg';
  scout.alt = '';
  scout.width = 56;
  scout.height = 56;
  hub.append(scout, el('span', '', 'Spark'));
  ring.append(hub);

  const detail = el('p', 'orbit-detail', 'Select a connector to see what it does.');
  detail.setAttribute('aria-live', 'polite');

  const badges = CONNECTORS.map((connector) => {
    const badge = button('badge', connector.name, () => {
      for (const other of badges) other.setAttribute('aria-pressed', 'false');
      badge.setAttribute('aria-pressed', 'true');
      detail.replaceChildren(el('strong', '', `${connector.name}: `), connector.text);
    });
    badge.setAttribute('aria-pressed', 'false');
    ring.append(badge);
    return badge;
  });

  let angle = 0;
  let paused = still;
  let visible = false;
  let last = 0;
  let looping = false;
  const pause = button('replay', 'Pause orbit', () => {
    paused = !paused;
    pause.textContent = paused ? 'Play orbit' : 'Pause orbit';
    if (!paused) start();
  });
  pause.hidden = still;
  host.append(ring, detail, pause);

  const place = () => {
    const width = ring.clientWidth / 2 - 64;
    const height = ring.clientHeight / 2 - 34;
    badges.forEach((badge, index) => {
      const theta = angle + (index / badges.length) * Math.PI * 2;
      const depth = (Math.sin(theta) + 1) / 2;
      badge.style.transform = `translate(-50%, -50%) translate(${Math.cos(theta) * width}px, ${Math.sin(theta) * height}px) scale(${0.86 + depth * 0.2})`;
      badge.style.zIndex = String(Math.round(depth * 10));
      badge.style.opacity = String(0.7 + depth * 0.3);
    });
  };

  const hovering = () => ring.matches(':hover') || ring.contains(document.activeElement);
  const tick = (time: number) => {
    if (paused || !visible) {
      looping = false;
      return;
    }
    if (!hovering()) angle += (time - last) * SPEED * Math.PI * 2;
    last = time;
    place();
    requestAnimationFrame(tick);
  };
  const start = () => {
    if (looping) return;
    looping = true;
    last = performance.now();
    requestAnimationFrame(tick);
  };

  place();
  new ResizeObserver(place).observe(ring);
  onVisibility(host, (now) => {
    visible = now;
    if (visible && !paused) start();
  });
}
