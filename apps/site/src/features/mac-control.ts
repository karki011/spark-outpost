import { button, el, frame } from '../dom.ts';
import { onceVisible, wait } from '../motion.ts';

const TERMINAL_LINES = [
  { className: 'prompt', text: '> Run the e2e suite and fix what fails' },
  { className: 'tool', text: '⏺ Bash(pnpm test:e2e)' },
  { className: 'out', text: '  ⎿ 41 passed, 1 failed: checkout.spec.ts' },
  { className: 'tool', text: '⏺ Update(src/cart.ts)' },
  { className: 'note', text: '— Spark restarted · this session kept running —' },
  { className: 'out', text: '  ⎿ 42 passed' },
];

function appWindow() {
  const { root, body } = frame('Tasks');
  root.classList.add('mac-app');
  const toolbar = el('div', 'app-toolbar');
  const exportButton = el('span', 'app-button', 'Export');
  const sendButton = el('span', 'app-button', 'Send');
  toolbar.append(el('span', 'app-button', 'New'), exportButton, sendButton);
  const list = el('ul', 'app-list');
  for (const task of ['Draft release notes', 'Check the beta feed', 'Reply to the design review']) {
    list.append(el('li', '', task));
  }
  const cursor = el('span', 'cursor');
  const card = el('div', 'app-card');
  body.append(toolbar, list, cursor, card);
  return { root, body, exportButton, sendButton, cursor, card };
}

function terminal() {
  const { root, body } = frame('Terminal session · tmux');
  root.classList.add('terminal');
  const lines = el('ol', 'terminal-lines');
  const status = el('div', 'tmux-status');
  status.append(el('span', '', '[spark] 0:claude*  1:pnpm dev'), el('span', 'state', 'Running'));
  body.append(lines, status);
  return { root, lines };
}

export function mountMacControl(host: HTMLElement, still: boolean): void {
  const app = appWindow();
  const term = terminal();
  const panel = el('p', 'mac-panel');
  panel.append(
    el('span', 'live-dot'),
    el('span', 'panel-text', 'Agent is using Tasks'),
    el('span', 'kbd', '⌃⌥⌘. stops'),
  );
  const visual = el('div', 'mac-stage');
  visual.setAttribute('aria-hidden', 'true');
  visual.append(app.root, panel, term.root);
  let running = false;
  const replay = button('replay', 'Replay', () => void play());
  replay.hidden = true;
  host.append(visual, replay);

  const pointAt = (target: HTMLElement) => {
    const box = app.body.getBoundingClientRect();
    const spot = target.getBoundingClientRect();
    app.cursor.style.transform = `translate(${spot.left - box.left + spot.width / 2}px, ${spot.top - box.top + spot.height / 2}px)`;
  };
  const showCard = (title: string, detail: string, answer: string) => {
    app.card.replaceChildren(
      el('strong', '', title),
      el('span', '', detail),
      el('span', 'chip solid', answer),
    );
    app.card.classList.add('on');
  };
  const say = (text: string) => {
    panel.querySelector('.panel-text')!.textContent = text;
  };

  const typeLines = async () => {
    term.lines.replaceChildren();
    for (const line of TERMINAL_LINES) {
      term.lines.append(el('li', line.className, line.text));
      if (!still) await wait(420);
    }
  };

  const play = async () => {
    if (running) return;
    running = true;
    replay.hidden = true;
    const typing = typeLines();
    if (still) {
      showCard('Press Send in Tasks?', 'A send asks every time, in every mode.', 'Allow once');
      app.sendButton.classList.add('hot');
      pointAt(app.sendButton);
      say('Waiting for you on the Mac');
      await typing;
      return;
    }
    app.card.classList.remove('on');
    app.exportButton.classList.remove('pressed');
    app.sendButton.classList.remove('hot');
    showCard(
      'Let the agent use Tasks in this chat?',
      'The first use of an app asks, reading included.',
      'Allow',
    );
    await wait(1600);
    app.card.classList.remove('on');
    say('Reading Tasks: 3 buttons, 1 list');
    await wait(700);
    pointAt(app.exportButton);
    await wait(800);
    app.exportButton.classList.add('pressed');
    say('Pressed Export · follows your mode');
    await wait(1100);
    pointAt(app.sendButton);
    await wait(800);
    app.sendButton.classList.add('hot');
    showCard('Press Send in Tasks?', 'A send asks every time, in every mode.', 'Allow once');
    say('Waiting for you on the Mac');
    await typing;
    running = false;
    replay.hidden = false;
  };

  if (still) void play();
  else onceVisible(host, () => void play());
}
