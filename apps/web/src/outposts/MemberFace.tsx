import { createContext, use, useMemo, type ComponentProps, type ReactNode } from 'react';
import { ChatFace } from '../brand/ChatFace.tsx';
import { listedFaces, memberFaces, type JoinedMember, type MemberFaces } from './member-faces.ts';

const NO_FACES: MemberFaces = new Map();
const NOBODY: readonly JoinedMember[] = [];
const FacesContext = createContext<MemberFaces>(NO_FACES);

interface OutpostFacesProps {
  members?: readonly JoinedMember[] | undefined;
  listed?: readonly string[] | undefined;
  children: ReactNode;
}

export function OutpostFaces({ members = NOBODY, listed, children }: OutpostFacesProps) {
  const listedKey = listed?.join(' ');
  const faces = useMemo(
    () =>
      listedKey === undefined
        ? memberFaces(members)
        : listedFaces(members, listedKey.split(' ').filter(Boolean)),
    [members, listedKey],
  );
  return <FacesContext value={faces}>{children}</FacesContext>;
}

export function MemberFace(props: Omit<ComponentProps<typeof ChatFace>, 'style'>) {
  const faces = use(FacesContext);
  return <ChatFace {...props} style={faces.get(props.chatId)} />;
}
