import type { ProviderCard } from '@spark-outpost/contracts';

const ASKS: Record<ProviderCard['asksBeforeCommands'], string> = {
  every: 'Every edit and command',
  'outside-sandbox-only': 'Outside its sandbox',
  never: 'Never',
};

export function ProviderSummary({ card }: { card: ProviderCard }) {
  const [from, to] = card.coldStartSeconds;
  const facts: [string, string][] = [
    ['Do mode', card.doMode === 'yes' ? 'With approvals' : 'Reads only'],
    ['Asks', ASKS[card.asksBeforeCommands]],
    ['Resume', card.resume === 'yes' ? 'Yes' : 'No'],
    ['Review', card.review === 'yes' ? 'Reviews others' : 'No'],
    ['Start-up', `${from}–${to} s`],
    ['Cost', card.costSource],
  ];
  return (
    <div className="mc-summary">
      <dl className="mc-badges">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details className="mc-more">
        <summary>Sandbox details</summary>
        <p>{card.sandbox}</p>
      </details>
    </div>
  );
}
