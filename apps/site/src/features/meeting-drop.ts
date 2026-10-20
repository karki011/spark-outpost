import { button, el } from '../dom.ts';
import { onceVisible, wait } from '../motion.ts';

const SNOOZE_DEMO_MS = 2400;

export function mountMeetingDrop(host: HTMLElement, still: boolean): void {
  const screen = el('div', 'desk');
  const rig = el('div', 'rig');
  const thread = el('span', 'thread');
  const scout = el('img', 'rig-scout');
  scout.src = '/scout.svg';
  scout.alt = '';
  scout.width = 46;
  scout.height = 46;

  const card = el('div', 'meeting-card');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Meeting alert');
  const when = el('p', 'meeting-when', 'In 1 min');
  const title = el('p', 'meeting-title', 'Standup');
  const detail = el('p', 'meeting-detail', '9:45 – 10:00 · Zoom');
  const actions = el('div', 'meeting-actions');
  card.append(when, title, detail, actions);
  rig.append(thread, scout, card);

  const status = el('p', 'desk-status');
  status.setAttribute('aria-live', 'polite');
  status.tabIndex = -1;
  const again = button('replay', 'Lower it again', () => lower('In 1 min', true));
  again.hidden = true;
  screen.append(el('span', 'desk-window'), rig);
  host.append(screen, status, again);

  const setDown = (down: boolean) => {
    rig.classList.toggle('down', down);
    card.inert = !down;
  };

  const lower = (label: string, takeFocus: boolean) => {
    when.textContent = label;
    status.textContent = '';
    again.hidden = true;
    setDown(true);
    if (takeFocus) actions.querySelector('button')?.focus();
  };

  const raise = (message: string, offerAgain: boolean) => {
    setDown(false);
    status.textContent = message;
    again.hidden = !offerAgain;
    if (offerAgain) again.focus();
    else status.focus();
  };

  actions.append(
    button('chip solid', 'Join', () =>
      raise('Join opens the Zoom link in your default browser.', true),
    ),
    button('chip', 'Snooze 1 min', async () => {
      raise('Snoozed. Scout comes back in a minute (here, a moment).', false);
      await wait(still ? 0 : SNOOZE_DEMO_MS);
      lower('Now', true);
    }),
    button('chip ghost', 'Dismiss', () => raise('Dismissed. Esc does the same.', true)),
  );
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') raise('Dismissed. Esc does the same.', true);
  });

  setDown(false);
  if (still) lower('In 1 min', false);
  else onceVisible(host, () => lower('In 1 min', false), 0.5);
}
