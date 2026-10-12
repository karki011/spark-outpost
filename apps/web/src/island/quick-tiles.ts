import type { TeammateFace } from '@spark-outpost/contracts';

export type StartId = 'new' | 'ask' | 'make' | 'chats';

export interface StartTile {
  id: StartId;
  name: string;
  sub: string | null;
  hint: string;
  face: TeammateFace;
}

export function startTiles(project: string | null, canMakeSpark: boolean): StartTile[] {
  return [
    {
      id: 'new',
      name: 'New chat',
      sub: project,
      hint: project ? `New chat in ${project}` : 'New chat',
      face: { shape: 'cloud', color: 'sky' },
    },
    {
      id: 'ask',
      name: 'Ask Spark',
      sub: null,
      hint: 'Ask Spark a question here',
      face: { shape: 'round', color: 'teal' },
    },
    canMakeSpark
      ? {
          id: 'make',
          name: 'New Spark',
          sub: null,
          hint: 'New Spark · opens in Spark',
          face: { shape: 'sun', color: 'plum' },
        }
      : {
          id: 'chats',
          name: 'All chats',
          sub: null,
          hint: 'All chats · opens the Chats tab',
          face: { shape: 'capsule', color: 'violet' },
        },
  ];
}

export interface NeedsYou {
  count: number;
  sub: string;
  label: string;
}

export function needsYou(waiting: number): NeedsYou | null {
  if (waiting < 1) return null;
  const chats = waiting === 1 ? '1 chat is waiting' : `${waiting} chats are waiting`;
  return { count: waiting, sub: 'Opens Chats', label: `Needs you: ${chats}. Opens the Chats tab` };
}
