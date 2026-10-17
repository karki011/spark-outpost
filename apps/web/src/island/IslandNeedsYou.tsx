import type { CalendarLine } from '../calendar/island-calendar.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { TickIcon } from '../ui/icons.tsx';
import type { NeedsYou, NeedsYouRow } from './needs-you.ts';

interface IslandNeedsYouProps {
  needs: NeedsYou;
  calendar: IslandCalendar;
  onOpenChat: (chatId: string) => void;
  onChats: () => void;
}

function openCalendarLine(line: CalendarLine, props: IslandNeedsYouProps): void {
  if (line.kind === 'capture') props.calendar.onCapture(line);
  else if (line.kind === 'catch-up') {
    props.calendar.onDismiss(line);
    props.onChats();
  } else if (line.choose) props.calendar.onChoose(line);
  else if (line.eventKey) props.calendar.onOpenEvent(line.eventKey);
}

function open(row: NeedsYouRow, props: IslandNeedsYouProps): void {
  if (row.kind === 'calendar') openCalendarLine(row.line, props);
  else props.onOpenChat(row.chatId);
}

export function IslandNeedsYou(props: IslandNeedsYouProps) {
  const { rows, more } = props.needs;
  return (
    <section className="isl-hcard isl-needs" aria-labelledby="isl-needs-h">
      <h3 id="isl-needs-h">Needs you</h3>
      {rows.length === 0 ? (
        <p className="isl-needs-quiet">
          <TickIcon />
          Nothing needs you
        </p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className="isl-needs-row"
                data-kind={row.kind}
                title={row.text}
                onClick={() => open(row, props)}
              >
                <span className="isl-needs-dot" aria-hidden="true" />
                <span className="isl-needs-text">{row.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <button type="button" className="isl-needs-more" onClick={props.onChats}>
          {more} more in Chats
        </button>
      )}
    </section>
  );
}
