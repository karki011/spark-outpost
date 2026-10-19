import type { HelperEvent } from '../../packages/contracts/src/index.ts';

export interface FakeAttendee {
  name: string;
  email?: string;
  isMe: boolean;
  status: 'accepted' | 'tentative';
  room?: boolean;
}

export interface FakeDetail {
  notes: string;
  attendees: FakeAttendee[];
}

type MakeEvent = (
  id: string,
  title: string,
  calendarId: string,
  start: number,
  minutes: number,
  extra?: Partial<HelperEvent> & Partial<FakeDetail>,
) => HelperEvent;

const MINUTE = 60_000;
const GOOGLE_FENCE = `-::~${':~'.repeat(40)}::-`;

export const BUSY_ZOOM_NOTES = [
  'Agenda: pricing page review and launch checklist.',
  'Doc: https://docs.example.com/d/launch',
  '',
  GOOGLE_FENCE,
  'Hazel Karki is inviting you to a scheduled Zoom meeting.',
  '',
  'Join Zoom Meeting',
  'https://cloudzero.zoom.us/j/81234567890?pwd=abc123',
  '',
  'Meeting ID: 812 3456 7890',
  'Passcode: 482913',
  '',
  'One tap mobile',
  '+13126266799,,81234567890#,,,,*482913# US (Chicago)',
  '',
  'Dial by your location',
  '• +1 312 626 6799 US (Chicago)',
  GOOGLE_FENCE,
].join('\n');

const MEET_NOTES = [
  'Weekly sync on the launch.',
  GOOGLE_FENCE,
  'Join with Google Meet: https://meet.google.com/abc-defg-hij',
  'Join by phone +1 312-626-6799 PIN: 123456789#',
  'Please do not edit this section.',
  GOOGLE_FENCE,
].join('\n');

const me: FakeAttendee = { name: 'Spark Tester', isMe: true, status: 'accepted' };

function team(count: number): FakeAttendee[] {
  const people = [
    { name: 'Alexandra Wong-Fitzgerald', email: 'alexandra.wong-fitzgerald@cloudzero.example' },
    { name: 'Ivan Marsh', email: 'ivan.marsh@cloudzero.example' },
    { name: 'Team Engineering', email: 'team-engineering@cloudzero.example' },
    { name: 'Priya Natarajan', email: 'priya@cloudzero.example' },
    { name: 'sam.lee@partner.example', email: 'sam.lee@partner.example' },
    { name: 'Jordan Blake', email: 'jordan@cloudzero.example' },
  ];
  return people.slice(0, count).map((person) => ({ ...person, isMe: false, status: 'accepted' }));
}

const room: FakeAttendee = {
  name: '33 Arch St-14-Bay Village (2)',
  email: 'c_188abc@resource.calendar.google.com',
  isMe: false,
  status: 'accepted',
  room: true,
};

export function busyEvents(event: MakeEvent, anchor: number, dayStart: number): HelperEvent[] {
  const at = (hours: number, minutes = 0) => dayStart + (hours * 60 + minutes) * MINUTE;
  return [
    event('busy-now', 'Launch review', 'fake-work', anchor + 4 * MINUTE, 30, {
      noteLinks: ['https://cloudzero.zoom.us/j/81234567890?pwd=abc123'],
      notes: BUSY_ZOOM_NOTES,
      attendees: [me, ...team(6), room],
      attendeeCount: 8,
    }),
    event('busy-offsite', 'Planning offsite', 'fake-work', at(9), 240, {
      location: '33 Arch St, Boston, MA 02110',
      attendees: [me, ...team(3)],
    }),
    event('busy-standup', 'Myra - Parent Teacher Conference', 'fake-family', at(9), 30),
    event('busy-pair', 'Pairing with Ivan', 'fake-work', at(9, 15), 45),
    event('busy-design', 'Design crit', 'fake-work', at(10), 30, {
      url: 'https://meet.google.com/abc-defg-hij',
      notes: MEET_NOTES,
      attendees: [me, ...team(2), room],
    }),
    event('busy-1on1', '1:1 with Priya', 'fake-work', at(11), 30),
    event('busy-lunch', 'Lunch', 'fake-family', at(12, 30), 45, { attendeeCount: 0 }),
    event('busy-vendor', 'Vendor sync', 'fake-work', at(13, 30), 30),
    event('busy-hiring', 'Hiring debrief', 'fake-work', at(14), 30),
    event('busy-support', 'Support rotation', 'fake-work', at(14, 30), 60),
    event('busy-roadmap', 'Roadmap', 'fake-work', at(15, 30), 60),
    event('busy-wrap', 'Week wrap-up', 'fake-work', at(17), 30),
  ];
}
