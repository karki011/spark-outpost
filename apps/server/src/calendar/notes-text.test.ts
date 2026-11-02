import { describe, expect, it } from 'vitest';
import { notesSnippet, notesText } from './google/map.ts';
import { splitNotes } from './notes-text.ts';
import { linkFreeSnippet } from './snippet.ts';

const GOOGLE_FENCE =
  '-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-';

const ZOOM_INVITE = [
  'Alex Rivera is inviting you to a scheduled Zoom meeting.',
  '',
  'Join Zoom Meeting',
  'https://acme.zoom.us/j/81234567890?pwd=abcDEF123',
  '',
  'Meeting ID: 812 3456 7890',
  'Passcode: 482913',
  '',
  '---',
  '',
  'One tap mobile',
  '+13126266799,,81234567890#,,,,*482913# US (Chicago)',
  '+16465588656,,81234567890#,,,,*482913# US (New York)',
  '',
  '---',
  '',
  'Dial by your location',
  '• +1 312 626 6799 US (Chicago)',
  '• +1 646 558 8656 US (New York)',
  '',
  'Meeting ID: 812 3456 7890',
  'Passcode: 482913',
  '',
  'Find your local number: https://acme.zoom.us/u/abc12',
  '',
  'Join by SIP',
  '• 81234567890@zoomcrc.com',
  '',
  'Join by H.323',
  '• 144.195.19.161 (US West)',
].join('\n');

const MEET_BLOCK = [
  GOOGLE_FENCE,
  'Join with Google Meet: https://meet.google.com/abc-defg-hij',
  'Or dial: (US) +1 312-626-6799 PIN: 123456789#',
  'More phone numbers: https://tel.meet/abc-defg-hij?pin=123456789',
  '',
  'Learn more about Meet at: https://support.google.com/a/users/answer/9282720',
  '',
  'Please do not edit this section.',
  GOOGLE_FENCE,
].join('\n');

const UNDERSCORES = '_'.repeat(80);
const SAFE_TEAMS = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0',
)}&data=05`;

const TEAMS_BLOCK = [
  UNDERSCORES,
  'Microsoft Teams meeting',
  'Join on your computer, mobile app or room device',
  `Click here to join the meeting<${SAFE_TEAMS}>`,
  'Meeting ID: 123 456 789 012',
  'Passcode: aB3cD4',
  'Download Teams<https://www.microsoft.com/microsoft-teams/download-app> | Join on the web<https://www.microsoft.com/microsoft-teams/join-a-meeting>',
  'Or call in (audio only)',
  '+1 312-626-6799,,123456789#   United States, Chicago',
  'Phone Conference ID: 123 456 789#',
  'Find a local number<https://dialin.teams.microsoft.com/x> | Reset PIN<https://dialin.teams.microsoft.com/usp/pstnconferencing>',
  'Learn More<https://aka.ms/JoinTeamsMeeting> | Meeting options<https://teams.microsoft.com/meetingOptions/>',
  UNDERSCORES,
].join('\n');

const WEBEX_TAIL = [
  '-- Do not delete or change any of the following text. --',
  '',
  "When it's time, join your Webex meeting here.",
  '',
  'Meeting number (access code): 2550 123 4567',
  'Meeting password: Xy12abc',
  '',
  'Join meeting<https://acme.webex.com/acme/j.php?MTID=m1234abcd>',
  '',
  'Join by phone',
  '+1-415-655-0001 US Toll',
  '',
  'Need help? Go to https://help.webex.com',
].join('\n');

describe('splitting the conference block from the agenda', () => {
  it('keeps the agenda above and below a Zoom invite and moves the dial-ins aside', () => {
    const notes = `Agenda:\n1. Q4 roadmap\n2. Hiring\n\n${ZOOM_INVITE}\n\nPlease read the doc first.`;
    const split = splitNotes(notes);
    expect(split.agenda).toBe('Agenda:\n1. Q4 roadmap\n2. Hiring\n\nPlease read the doc first.');
    expect(split.conference).toContain('One tap mobile');
    expect(split.conference).toContain('+1 312 626 6799 US (Chicago)');
    expect(split.conference).not.toContain('Agenda');
  });

  it('drops the Google separator lines and the Meet section between them', () => {
    const split = splitNotes(`Weekly sync on the launch.\n\n${MEET_BLOCK}`);
    expect(split.agenda).toBe('Weekly sync on the launch.');
    expect(split.conference).toContain('Or dial: (US) +1 312-626-6799');
    expect(split.conference).not.toContain('-::~');
  });

  it('drops a lone Google separator line', () => {
    expect(splitNotes(`${GOOGLE_FENCE}\nBring your laptop`).agenda).toBe('Bring your laptop');
  });

  it('moves a Teams block between underscore lines, SafeLinks and all', () => {
    const split = splitNotes(`Quarterly review with finance.\n\n${TEAMS_BLOCK}\n`);
    expect(split.agenda).toBe('Quarterly review with finance.');
    expect(split.conference).toContain('Phone Conference ID');
    expect(split.conference).not.toContain('____');
  });

  it('keeps underscore lines that frame something other than Teams', () => {
    const notes = `${UNDERSCORES}\nNotes from last time\n${UNDERSCORES}`;
    expect(splitNotes(notes).agenda).toBe(notes);
  });

  it('moves the Webex tail from its do-not-delete line to the end', () => {
    const split = splitNotes(`Partner onboarding\n\n${WEBEX_TAIL}`);
    expect(split.agenda).toBe('Partner onboarding');
    expect(split.conference).toContain('Join by phone');
    expect(split.conference).not.toContain('Do not delete');
  });

  it('keeps user text that only mentions a meeting id or a phone number', () => {
    const notes = 'Meeting ID will be sent later.\nCall me on +1 312 555 0100 if late.';
    expect(splitNotes(notes)).toEqual({ agenda: notes, conference: '' });
  });

  it('builds the card snippet from the agenda alone', () => {
    const notes = `${MEET_BLOCK}\nDiscuss the pricing page (https://docs.example.com/p)`;
    expect(linkFreeSnippet(notes)).toBe('Discuss the pricing page');
  });

  it('builds the Google snippet without the Zoom block or its link label', () => {
    const description = `Topics:<br>Roadmap<br><br>${ZOOM_INVITE.replace(/\n/g, '<br>')}`;
    expect(notesSnippet(description)).toBe('Topics: Roadmap');
    expect(splitNotes(notesText(description)).agenda).toBe('Topics:\nRoadmap');
  });
});
