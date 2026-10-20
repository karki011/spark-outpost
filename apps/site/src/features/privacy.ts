import { button, el } from '../dom.ts';

const STAYS = ['Chats and history', 'Settings', 'Your code', 'Keys, in your Keychain', 'Audit log'];

const LEAVES = [
  {
    to: 'Your AI provider',
    what: 'Your messages, and the files, output and pages the agent reads.',
  },
  {
    to: 'GitHub, Atlassian, Linear, Slack',
    what: 'What you or an agent sends them. Disconnect any time.',
  },
  { to: 'Sites agents open', what: 'Addresses and typed text. Never your saved sign-ins.' },
  {
    to: 'Push services',
    what: 'Encrypted notifications for paired devices, when you turn them on.',
  },
  { to: 'Spark Outpost team', what: 'An anonymous heartbeat. Turn it off in Settings.' },
];

export function mountPrivacy(host: HTMLElement): void {
  const map = el('div', 'privacy-map');
  const mac = el('div', 'privacy-mac');
  mac.append(el('p', 'privacy-head', 'Stays on your Mac'));
  const stays = el('ul', 'stays');
  for (const item of STAYS) stays.append(el('li', '', item));
  mac.append(stays);

  const out = el('div', 'privacy-out');
  out.append(el('p', 'privacy-head', 'Leaves only for the work'));
  const detail = el('p', 'privacy-detail');
  detail.setAttribute('aria-live', 'polite');
  const list = el('ul', 'leaves');
  const choices = LEAVES.map((leave) => {
    const item = el('li');
    const choice = button('leave', leave.to, () => select(choice, leave.what));
    choice.setAttribute('aria-pressed', 'false');
    item.append(choice);
    list.append(item);
    return choice;
  });
  out.append(list, detail);
  map.append(mac, el('span', 'privacy-beam'), out);
  host.append(map);

  const select = (choice: HTMLButtonElement, what: string) => {
    for (const other of choices) other.setAttribute('aria-pressed', String(other === choice));
    map.classList.add('sending');
    detail.textContent = what;
  };
  select(choices[0]!, LEAVES[0]!.what);
}
