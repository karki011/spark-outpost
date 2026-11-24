import { MarkTile, markLetters } from './MarkTile.tsx';

interface UserAvatarProps {
  displayName: string;
  size?: number;
}

export function UserAvatar({ displayName, size = 28 }: UserAvatarProps) {
  return <MarkTile letters={markLetters(displayName)} size={size} />;
}
