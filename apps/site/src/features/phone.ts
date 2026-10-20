import { button, el } from '../dom.ts';
import { onceVisible, wait } from '../motion.ts';

export function mountPhone(host: HTMLElement, still: boolean): void {
  const scene = el('div', 'remote');
  const phone = el('div', 'phone');
  const notch = el('span', 'phone-notch');
  const push = el('div', 'push');
  push.append(
    el('strong', '', 'Spark Outpost'),
    el('span', '', 'Fix the flaky checkout test needs you'),
  );

  const card = el('div', 'phone-card');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Approval card on a paired phone');
  const question = el('p', 'phone-question', 'Run a command?');
  const command = el('code', '', 'pnpm test:e2e');
  const reason = el('p', 'phone-reason', 'Claude: run the end-to-end suite after the fix.');
  const answers = el('div', 'phone-answers');
  card.append(question, command, reason, answers);
  phone.append(notch, push, card);

  const link = el('div', 'tailnet');
  link.append(el('span', 'tailnet-label', 'Tailscale'), el('span', 'packet'));
  const mac = el('div', 'mac-box');
  const macState = el('p', 'mac-state', 'Waiting for you');
  mac.append(el('span', 'mac-screen'), el('strong', '', 'Your Mac'), macState);
  scene.append(phone, link, mac);

  const status = el('p', 'desk-status');
  status.setAttribute('aria-live', 'polite');
  const reset = button('replay', 'Start over', () => void begin());
  reset.hidden = true;
  host.append(scene, status, reset);

  const answer = async (allowed: boolean) => {
    card.inert = true;
    scene.classList.add('sending');
    await wait(still ? 0 : 900);
    scene.classList.remove('sending');
    macState.textContent = allowed
      ? 'Allowed from your phone · running'
      : 'Denied · the agent is told';
    card.classList.add('answered');
    question.textContent = allowed ? 'Allowed' : 'Denied';
    status.textContent = allowed
      ? 'The answer reached the Mac over your tailnet. The run goes on there.'
      : 'Denied. You can add a reason on the phone, too.';
    reset.hidden = false;
    reset.focus();
  };
  answers.append(
    button('chip ghost', 'Deny', () => void answer(false)),
    button('chip solid', 'Allow', () => void answer(true)),
  );

  const begin = async () => {
    reset.hidden = true;
    status.textContent = '';
    card.inert = true;
    card.classList.remove('open', 'answered');
    question.textContent = 'Run a command?';
    macState.textContent = 'Waiting for you';
    push.classList.add('on');
    await wait(still ? 0 : 1300);
    push.classList.remove('on');
    card.classList.add('open');
    card.inert = false;
  };

  card.inert = true;
  if (still) void begin();
  else onceVisible(host, () => void begin(), 0.5);
}
