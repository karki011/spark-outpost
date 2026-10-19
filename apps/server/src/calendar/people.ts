import { CALENDAR_ATTENDEES_MAX, type CalendarPerson } from '@spark-outpost/contracts';

const TEXT_MAX = 300;
const LOCATION_MAX = 2_000;
const ROOM_EMAIL = /@resource\.calendar\.google\.com$/i;

export interface Invitee {
  name: string;
  email: string | null;
  isMe: boolean;
  room: boolean;
}

const isRoom = (invitee: Invitee) =>
  invitee.room || (invitee.email !== null && ROOM_EMAIL.test(invitee.email));

export function peopleOf(invitees: readonly Invitee[]): CalendarPerson[] {
  return invitees
    .filter((invitee) => !invitee.isMe && !isRoom(invitee))
    .flatMap((invitee) => {
      const email = invitee.email?.trim().slice(0, TEXT_MAX) || null;
      const name = invitee.name.trim().slice(0, TEXT_MAX) || email;
      return name ? [{ name, email }] : [];
    })
    .slice(0, CALENDAR_ATTENDEES_MAX);
}

export function locationOf(location: string | null, invitees: readonly Invitee[]): string | null {
  const given = location?.trim();
  if (given) return given.slice(0, LOCATION_MAX);
  const rooms = invitees
    .filter(isRoom)
    .map((invitee) => invitee.name.trim())
    .filter((name) => name !== '' && !ROOM_EMAIL.test(name));
  return rooms.length > 0 ? rooms.join(', ').slice(0, LOCATION_MAX) : null;
}
