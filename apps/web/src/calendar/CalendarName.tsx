import './calendar-parts.css';
interface CalendarNameProps {
  name: string;
  className?: string;
}

export function CalendarName({ name, className }: CalendarNameProps) {
  return (
    <span className={className ? `cal-clip ${className}` : 'cal-clip'} title={name}>
      {name}
    </span>
  );
}
