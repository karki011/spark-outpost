import { TEAMMATE_COLORS, type TeammateColor } from '@spark-outpost/contracts';
import { CHAT_FACE_SHAPES, chatFaceStyle, type ChatFaceStyle } from '../brand/chat-face.ts';

export interface JoinedMember {
  conversationId: string;
  joinedAt: string;
  position?: number;
}

export type MemberFaces = ReadonlyMap<string, ChatFaceStyle>;

interface Taken {
  colors: Set<TeammateColor>;
  styles: Set<string>;
}

function styleKey(style: ChatFaceStyle): string {
  return `${style.color}/${style.shape}`;
}

function byJoin(a: JoinedMember, b: JoinedMember): number {
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1;
  const positions = (a.position ?? 0) - (b.position ?? 0);
  if (positions !== 0) return positions;
  if (a.conversationId === b.conversationId) return 0;
  return a.conversationId < b.conversationId ? -1 : 1;
}

function fromOwn<T>(all: readonly T[], own: T): T[] {
  const start = all.indexOf(own);
  return [...all.slice(start), ...all.slice(0, start)];
}

function freeShape(own: ChatFaceStyle, taken: Taken): ChatFaceStyle {
  for (const color of fromOwn(TEAMMATE_COLORS, own.color)) {
    for (const shape of fromOwn(CHAT_FACE_SHAPES, own.shape)) {
      if (!taken.styles.has(styleKey({ color, shape }))) return { color, shape };
    }
  }
  return own;
}

function freeStyle(own: ChatFaceStyle, taken: Taken): ChatFaceStyle {
  if (!taken.colors.has(own.color)) return own;
  const color = TEAMMATE_COLORS.find((candidate) => !taken.colors.has(candidate));
  return color ? { color, shape: own.shape } : freeShape(own, taken);
}

function facesInOrder(conversationIds: readonly string[]): MemberFaces {
  const faces = new Map<string, ChatFaceStyle>();
  const taken: Taken = { colors: new Set(), styles: new Set() };
  for (const conversationId of conversationIds) {
    if (faces.has(conversationId)) continue;
    const style = freeStyle(chatFaceStyle(conversationId), taken);
    faces.set(conversationId, style);
    taken.colors.add(style.color);
    taken.styles.add(styleKey(style));
  }
  return faces;
}

function joinOrder(members: readonly JoinedMember[]): string[] {
  return [...members].sort(byJoin).map((member) => member.conversationId);
}

export function memberFaces(members: readonly JoinedMember[]): MemberFaces {
  return facesInOrder(joinOrder(members));
}

export function listedFaces(
  joined: readonly JoinedMember[],
  listed: readonly string[],
): MemberFaces {
  const kept = new Set(listed);
  const staying = joinOrder(joined).filter((conversationId) => kept.has(conversationId));
  return facesInOrder([...staying, ...listed]);
}
