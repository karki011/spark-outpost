import { describe, expect, it } from 'vitest';
import { joinLeadMs, joinLink, joinOpen } from './calendar-join.ts';

const fromUrl = (url: string) => joinLink({ url, location: null, noteLinks: [] });

describe('joinLink', () => {
  it.each([
    ['https://zoom.us/j/123456789', 'zoom', 'zoom.us'],
    ['https://acme.zoom.us/j/123456789?pwd=x', 'zoom', 'acme.zoom.us'],
    ['https://acme.zoomgov.com/my/room', 'zoom', 'acme.zoomgov.com'],
    ['https://zoom.us:443/w/1', 'zoom', 'zoom.us'],
    ['https://meet.google.com/abc-defg-hij', 'meet', 'meet.google.com'],
    ['https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0', 'teams', 'teams.microsoft.com'],
    ['https://teams.live.com/meet/9351', 'teams', 'teams.live.com'],
    ['https://acme.webex.com/meet/sam', 'webex', 'acme.webex.com'],
    ['https://acme.webex.com/acme/j.php?MTID=m1', 'webex', 'acme.webex.com'],
    ['https://acme.webex.com/j.php?MTID=m1', 'webex', 'acme.webex.com'],
    ['https://acme.webex.com/wbxmjs/joinservice/sites/acme/meeting/x', 'webex', 'acme.webex.com'],
  ])('accepts %s', (url, service, host) => {
    expect(fromUrl(url)).toMatchObject({ service, host, unwrappedFrom: null });
  });

  it.each([
    'https://zoom.us.evil.com/j/1',
    'https://evilzoom.us/j/1',
    'https://user@zoom.us/j/1',
    'https://user:pass@zoom.us/j/1',
    'http://zoom.us/j/1',
    'https://zoom.us:8443/j/1',
    'https://zoom.us/',
    'https://zoom.us/signin',
    'https://meet.google.com.evil.com/abc-defg-hij',
    'https://meet.google.com/landing',
    'https://webex.com/meet/x',
    'https://acme.webex.com/a/b/j.php',
    'https://teams.microsoft.com.evil.com/l/meetup-join/1',
    'https://notteams.microsoft.com/l/meetup-join/1',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (url) => {
    expect(fromUrl(url)).toBeNull();
  });

  it('unwraps an Outlook SafeLinks wrapper only around a Teams link', () => {
    const teams = encodeURIComponent('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0');
    const link = fromUrl(`https://nam12.safelinks.protection.outlook.com/?url=${teams}&data=1`);
    expect(link).toMatchObject({
      service: 'teams',
      host: 'teams.microsoft.com',
      unwrappedFrom: 'Outlook SafeLinks',
    });
    expect(link?.url.startsWith('https://teams.microsoft.com/l/meetup-join/')).toBe(true);
  });

  it.each([
    'https://zoom.us/j/1',
    'https://meet.google.com/abc-defg-hij',
    'https://evil.example/teams',
    'http://teams.microsoft.com/l/meetup-join/1',
    'https://teams.microsoft.com.evil.com/l/meetup-join/1',
  ])('refuses a SafeLinks wrapper around %s', (inner) => {
    const wrapped = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(inner)}`;
    expect(fromUrl(wrapped)).toBeNull();
  });

  it('refuses a lookalike SafeLinks host', () => {
    const teams = encodeURIComponent('https://teams.microsoft.com/l/meetup-join/1');
    expect(fromUrl(`https://safelinks.protection.outlook.com.evil.com/?url=${teams}`)).toBeNull();
  });

  it('looks in the URL, then the location, then the notes', () => {
    const link = joinLink({
      url: 'https://example.com/agenda',
      location: 'Room 4 · https://acme.zoom.us/j/42',
      noteLinks: ['https://meet.google.com/abc-defg-hij'],
    });
    expect(link?.service).toBe('zoom');
    expect(
      joinLink({
        url: null,
        location: 'Room 4',
        noteLinks: ['https://meet.google.com/abc-defg-hij'],
      })?.service,
    ).toBe('meet');
    expect(joinLink({ url: null, location: null, noteLinks: [] })).toBeNull();
  });
});

describe('joinOpen', () => {
  const start = Date.parse('2026-10-16T09:30:00Z');
  const end = start + 15 * 60_000;

  it.each([10, 5, 2, 0])('opens %i min before the start and closes at the end', (minutes) => {
    const lead = minutes * 60_000;
    expect(joinOpen({ start, end }, start - lead - 1, lead)).toBe(false);
    expect(joinOpen({ start, end }, start - lead, lead)).toBe(true);
    expect(joinOpen({ start, end }, end - 1, lead)).toBe(true);
    expect(joinOpen({ start, end }, end, lead)).toBe(false);
  });

  it('reads the lead from the Join opens setting', () => {
    expect(joinLeadMs({ joinLead: 10 })).toBe(600_000);
    expect(joinLeadMs({ joinLead: 0 })).toBe(0);
  });
});
