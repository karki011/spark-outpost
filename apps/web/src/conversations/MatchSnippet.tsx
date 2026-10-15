import './match-snippet.css';
import type { SearchMatch } from '@spark-outpost/contracts';

export function MatchSnippet({ match }: { match: SearchMatch }) {
  return (
    <span className="match-snippet">
      {match.parts.map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </span>
  );
}
