import { describe, expect, it } from 'vitest';
import { descriptionParts, looksLikeAddress, mapsUrl } from './description-parts.ts';

const kinds = (text: string) => descriptionParts(text).map((part) => part.kind);

describe('descriptionParts', () => {
  it('turns https links into links with their host and keeps the text around them', () => {
    const parts = descriptionParts('Read the doc (https://docs.example.com/d/1), then vote.');
    expect(parts).toEqual([
      { kind: 'text', text: 'Read the doc ' },
      { kind: 'link', url: 'https://docs.example.com/d/1', host: 'docs.example.com', join: null },
      { kind: 'text', text: ', then vote.' },
    ]);
  });

  it('marks a meeting link as a join link', () => {
    const [, link] = descriptionParts('Join Zoom Meeting\nhttps://acme.zoom.us/j/812?pwd=x.');
    expect(link).toMatchObject({ kind: 'link', host: 'acme.zoom.us' });
    expect(link?.kind === 'link' && link.join?.service).toBe('zoom');
  });

  it('unwraps SafeLinks around Teams and leaves any other SafeLinks as the wrapper', () => {
    const teams = encodeURIComponent('https://teams.microsoft.com/l/meetup-join/19%3a1/0');
    const wrapped = `Click here<https://nam12.safelinks.protection.outlook.com/?url=${teams}&data=1>`;
    const [, link] = descriptionParts(wrapped);
    expect(link).toMatchObject({ kind: 'link', host: 'teams.microsoft.com' });
    const other = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent('https://evil.example.com')}`;
    expect(descriptionParts(other)[0]).toMatchObject({
      kind: 'link',
      host: 'nam12.safelinks.protection.outlook.com',
      join: null,
    });
  });

  it('never links http, javascript, file or a link with a login in it', () => {
    for (const text of [
      'http://example.com/a',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:pw@example.com/a',
    ]) {
      expect(kinds(text)).toEqual(['text']);
    }
  });

  it('finds phone numbers with a country code or US shape', () => {
    const parts = descriptionParts('Join by phone +1 312-626-6799 or (312) 626-6799');
    expect(parts.filter((part) => part.kind === 'phone')).toEqual([
      { kind: 'phone', text: '+1 312-626-6799', number: '+13126266799' },
      { kind: 'phone', text: '(312) 626-6799', number: '3126266799' },
    ]);
    expect(descriptionParts('+13126266799,,81234567890#,,,,*482913# US')[0]).toMatchObject({
      kind: 'phone',
      number: '+13126266799',
    });
  });

  it('leaves dates, times and meeting ids alone', () => {
    expect(kinds('2026-10-19 10:00-11:00, Meeting ID: 812 3456 7890')).toEqual(['text']);
  });
});

describe('locations', () => {
  it('opens a street address in Maps and nothing else', () => {
    expect(looksLikeAddress('33 Arch St, Boston, MA 02110')).toBe(true);
    expect(looksLikeAddress('1 Infinite Loop, Cupertino')).toBe(true);
    expect(looksLikeAddress('33 Arch St-14-Bay Village (2)')).toBe(false);
    expect(looksLikeAddress('Microsoft Teams Meeting')).toBe(false);
    expect(looksLikeAddress('Room 4')).toBe(false);
    expect(looksLikeAddress('https://acme.zoom.us/j/1')).toBe(false);
    expect(mapsUrl(' 33 Arch St ')).toBe('https://maps.apple.com/?q=33%20Arch%20St');
  });
});
