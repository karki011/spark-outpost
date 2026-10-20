import type { HelperEvent } from '../../packages/contracts/src/index.ts';
import type { FakeDetail } from './fake-calendar-busy.ts';

type MakeEvent = (
  id: string,
  title: string,
  calendarId: string,
  start: number,
  minutes: number,
  extra?: Partial<HelperEvent> & Partial<FakeDetail>,
) => HelperEvent;

export const DAY_HTML_NOTES =
  'Setting aside 15 minutes Mon-Thu for our team stand-up.<br><br>Agenda is to quickly have each member of the team run through the following topics, using the Kanban board as the backdrop:<ul><li>What did you do yesterday?<br></li><li>What are your goals for today?<br></li><li>Are there any blockers?</li></ul>' +
  'Link to Kanban board: <a href="https://acme.atlassian.net/jira/boards/1" target="_blank"><u>https://acme.atlassian.net/jira/boards/1</u></a>.' +
  '<p onclick="steal()">Tom&#39;s &amp; Ann&rsquo;s notes</p><script>alert("x")</script>' +
  '<a href="javascript:alert(1)">Do not link</a><img src="https://tracker.example/pixel.png">';

export function dayEvents(event: MakeEvent, at: (minutes: number) => number): HelperEvent[] {
  return [
    event('day-standup', 'Team Cirrus Standup', 'fake-work', at(60), 30, {
      url: 'https://acme.zoom.us/j/81234567890',
      notes: DAY_HTML_NOTES,
    }),
    event('day-pickup', 'Bus pickup', 'fake-family', at(65), 30, {
      attendeeCount: 0,
      othersInvited: false,
      myStatus: 'none',
    }),
    event(
      'day-quick',
      'Quick check-in with a long title that will not fit',
      'fake-work',
      at(150),
      15,
    ),
    event('day-review', 'Design review', 'fake-work', at(180), 60),
    event('day-live', 'Live review', 'fake-work', at(-5), 30, {
      url: 'https://meet.google.com/abc-defg-hij',
    }),
    event('day-done', 'Morning sync', 'fake-work', at(-90), 30, {
      url: 'https://acme.zoom.us/j/81234567000',
    }),
  ];
}
