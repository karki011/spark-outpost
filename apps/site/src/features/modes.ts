import { el, frame } from '../dom.ts';

type Outcome = 'reads' | 'card' | 'runs' | 'agent' | 'unreviewed';

interface Mode {
  name: string;
  summary: string;
  edit: Outcome;
  command: Outcome;
}

const MODES: Record<'Claude' | 'Codex', Mode[]> = {
  Claude: [
    { name: 'Plan', summary: 'Reads only, plans first', edit: 'reads', command: 'reads' },
    { name: 'Manual', summary: 'Asks before edits and commands', edit: 'card', command: 'card' },
    {
      name: 'Accept edits',
      summary: 'Edits freely, asks for commands',
      edit: 'runs',
      command: 'card',
    },
    { name: 'Auto', summary: 'The agent decides what to ask', edit: 'agent', command: 'agent' },
    {
      name: 'Bypass permissions',
      summary: 'Never asks',
      edit: 'unreviewed',
      command: 'unreviewed',
    },
  ],
  Codex: [
    { name: 'Read-only', summary: 'Reads only', edit: 'reads', command: 'reads' },
    {
      name: 'Ask every time',
      summary: 'Asks before edits and commands',
      edit: 'card',
      command: 'card',
    },
    {
      name: 'Workspace access',
      summary: 'Works in the project without asking',
      edit: 'unreviewed',
      command: 'unreviewed',
    },
    {
      name: 'Auto review',
      summary: 'The agent decides what to ask',
      edit: 'unreviewed',
      command: 'unreviewed',
    },
    { name: 'Full access', summary: 'Never asks', edit: 'unreviewed', command: 'unreviewed' },
  ],
};

const OUTCOME_TEXT: Record<Outcome, string> = {
  reads: 'Not in this mode: reads and plans only',
  card: 'Approval card: Allow once or Reject',
  runs: 'Runs at once',
  agent: 'Runs, unless the agent asks',
  unreviewed: 'Runs, marked ran without review',
};

function step(label: string, outcome: Outcome): HTMLElement {
  const row = el('li', `step outcome-${outcome}`);
  row.append(el('code', '', label), el('span', 'step-result', OUTCOME_TEXT[outcome]));
  if (outcome === 'card') {
    const card = el('span', 'mini-card');
    card.append(el('span', 'chip ghost', 'Reject'), el('span', 'chip solid', 'Allow once'));
    row.append(card);
  }
  return row;
}

function floorRow(mode: Mode): HTMLElement {
  const seen = mode.command !== 'unreviewed';
  const row = el('li', `step floor ${seen ? 'outcome-refused' : 'outcome-flagged'}`);
  row.append(
    el('code', '', 'git push origin main'),
    el(
      'span',
      'step-result',
      seen ? "Refused by Spark's policy" : 'Flagged: card, island notice and audit entry',
    ),
  );
  return row;
}

export function mountModes(host: HTMLElement, still: boolean): void {
  let provider: keyof typeof MODES = 'Claude';
  let current = MODES.Claude[3]!;
  const { root, body } = frame('acme-web · Fix the flaky checkout test');

  const providers = el('div', 'segmented');
  providers.setAttribute('role', 'group');
  providers.setAttribute('aria-label', 'Agent');
  const modeList = el('fieldset', 'mode-list');
  const legend = el('legend', 'sr-only', 'Agent mode');
  const transcript = el('ol', 'transcript');
  transcript.setAttribute('aria-live', 'polite');

  const render = () => {
    transcript.replaceChildren(
      el('li', 'bubble user', 'Fix the flaky checkout test'),
      el('li', 'bubble agent', 'Found a race in cart.ts. I’ll patch it and run the tests.'),
      step('Edit cart.ts', current.edit),
      step('pnpm test', current.command),
      floorRow(current),
    );
    if (still) return;
    transcript.querySelectorAll<HTMLElement>('.step').forEach((row, index) => {
      row.style.animationDelay = `${120 + index * 140}ms`;
    });
  };

  const renderModes = () => {
    modeList.replaceChildren(legend);
    for (const mode of MODES[provider]) {
      const label = el('label', 'mode-option');
      const input = el('input');
      input.type = 'radio';
      input.name = 'agent-mode';
      input.checked = mode === current;
      input.addEventListener('change', () => {
        current = mode;
        render();
      });
      const text = el('span', 'mode-text');
      text.append(el('strong', '', mode.name), el('span', '', mode.summary));
      label.append(input, text);
      modeList.append(label);
    }
  };

  for (const name of Object.keys(MODES) as (keyof typeof MODES)[]) {
    const toggle = el('button', 'segment', name === 'Claude' ? 'Claude Code' : 'Codex');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', String(name === provider));
    toggle.addEventListener('click', () => {
      provider = name;
      current = MODES[name].find((mode) => mode.command === 'agent') ?? MODES[name][2]!;
      for (const other of providers.children) other.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-pressed', 'true');
      renderModes();
      render();
    });
    providers.append(toggle);
  }

  const controls = el('div', 'mode-controls');
  controls.append(providers, modeList);
  body.append(controls, transcript);
  host.append(root);
  renderModes();
  render();
}
