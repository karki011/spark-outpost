import { describe, expect, it } from 'vitest';
import { locationOf, peopleOf, type Invitee } from './people.ts';

const person = (name: string, email: string | null, extra: Partial<Invitee> = {}): Invitee => ({
  name,
  email,
  isMe: false,
  room: false,
  ...extra,
});

describe('people and rooms on an event', () => {
  const invitees = [
    person('Me', 'me@example.com', { isMe: true }),
    person('Ana Lee', 'ana@example.com'),
    person('', 'bo@example.com'),
    person('33 Arch St-14-Bay Village (2)', 'c_9@resource.calendar.google.com'),
    person('Projector', null, { room: true }),
  ];

  it('lists people without the user or any room, falling back to the email', () => {
    expect(peopleOf(invitees)).toEqual([
      { name: 'Ana Lee', email: 'ana@example.com' },
      { name: 'bo@example.com', email: 'bo@example.com' },
    ]);
  });

  it('uses the event location first and the rooms when it has none', () => {
    expect(locationOf('HQ, Floor 3', invitees)).toBe('HQ, Floor 3');
    expect(locationOf('  ', invitees)).toBe('33 Arch St-14-Bay Village (2), Projector');
    const unnamed = [person('c_1@resource.calendar.google.com', null, { room: true })];
    expect(locationOf(null, unnamed)).toBeNull();
  });
});
