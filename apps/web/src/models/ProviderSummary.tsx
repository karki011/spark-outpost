import type { ProviderCard } from '@spark-outpost/contracts';

const ASKS: Record<ProviderCard['asksBeforeCommands'], string> = {
  every: 'Asks before edits and commands',
  'outside-sandbox-only': 'Asks outside its sandbox',
  never: 'Never asks',
};

export function ProviderSummary({ card }: { card: ProviderCard }) {
  const [from, to] = card.coldStartSeconds;
  const line = [ASKS[card.asksBeforeCommands], card.resume === 'yes' ? 'resumes chats' : null]
    .filter(Boolean)
    .join(' · ');
  const facts: [string, string][] = [
    ['Do mode', card.doMode === 'yes' ? 'With approvals' : 'Reads only'],
    ['Reviews others', card.review === 'yes' ? 'Yes' : 'No'],
    ['Start-up', `${from}–${to} s`],
    ['Cost', card.costSource],
  ];
  return (
    <div className="mc-summary">
      <p className="mc-line">{line}</p>
      <details className="mc-more">
        <summary>About {card.label}</summary>
        <dl className="mc-about">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p>{card.sandbox}</p>
      </details>
    </div>
  );
}
