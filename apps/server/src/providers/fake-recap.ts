const RECAP_TRIGGER = '\n<week>\n';
const REFINE_TRIGGER = '\n<request>\n';

interface FakeFact {
  id: string;
  kind: string;
  title?: string;
  number?: string;
  key?: string;
  waitingOnYou?: string;
}

function factsOf(prompt: string): FakeFact[] {
  const start = prompt.indexOf(RECAP_TRIGGER) + RECAP_TRIGGER.length;
  const end = prompt.indexOf('\n</week>', start);
  return (JSON.parse(prompt.slice(start, end)) as { facts: FakeFact[] }).facts;
}

function named(fact: FakeFact): string {
  return [fact.title ?? 'work', fact.number ?? fact.key].filter(Boolean).join(' ');
}

function fakeRecapReply(prompt: string): string {
  const facts = factsOf(prompt);
  const done = facts.filter((fact) => fact.kind === 'pull' || fact.kind === 'chat');
  const waiting = facts.filter((fact) => fact.waitingOnYou);
  return JSON.stringify({
    done: done.map((fact) => ({
      me: `I finished ${named(fact)}.`,
      manager: `Finished ${named(fact)}.`,
      facts: [fact.id],
    })),
    progress: [{ me: 'I invented #9999.', manager: 'Invented #9999.', facts: ['c1'] }],
    help: [],
    you: waiting.map((fact) => ({
      me: `${fact.title} waits on you.`,
      manager: null,
      facts: [fact.id],
    })),
  });
}

function fakeRefineReply(prompt: string): string {
  const start = prompt.indexOf('\n<draft>\n') + 9;
  const draft = prompt.slice(start, prompt.indexOf('\n</draft>', start));
  const request = prompt
    .slice(prompt.indexOf(REFINE_TRIGGER) + REFINE_TRIGGER.length)
    .split('\n')[0];
  return `${draft}\n\n_Refined: ${request}_ (#424242)`;
}

export function fakeRecapText(prompt: string): string | null {
  if (prompt.includes(REFINE_TRIGGER) && prompt.includes('\n<draft>\n')) {
    return fakeRefineReply(prompt);
  }
  if (prompt.includes(RECAP_TRIGGER)) return fakeRecapReply(prompt);
  return null;
}
