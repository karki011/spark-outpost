import { useQuery } from '@tanstack/react-query';
import { assistantApi, assistantKeys } from '../../api/assistant.ts';
import './assistant.css';

function time(at: string): string {
  return new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AssistantReadOnly() {
  const events = useQuery({ queryKey: assistantKeys.events, queryFn: assistantApi.events });
  const shown = events.data ?? [];
  return (
    <section className="assistant-readonly" aria-label="Ask Spark activity">
      <p>Ask Spark’s conversation is read-only here. Ask your questions from the island.</p>
      {shown.length > 0 && (
        <ul aria-label="Ask Spark events">
          {shown.map((event) => (
            <li key={event.id}>
              <time dateTime={event.at}>{time(event.at)}</time> · {event.line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
