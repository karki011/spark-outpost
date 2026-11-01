import type { BrowserSpace } from '@spark-outpost/contracts';
import {
  BookIcon,
  CloudIcon,
  CommentIcon,
  HomeIcon,
  LaptopIcon,
  PeopleIcon,
  TerminalIcon,
  VideoIcon,
} from '../ui/icons.tsx';

const ICONS: Record<BrowserSpace['icon'], () => React.JSX.Element> = {
  home: HomeIcon,
  book: BookIcon,
  people: PeopleIcon,
  laptop: LaptopIcon,
  cloud: CloudIcon,
  terminal: TerminalIcon,
  video: VideoIcon,
  comment: CommentIcon,
};

export const ICON_NAMES: Record<BrowserSpace['icon'], string> = {
  home: 'Home',
  book: 'Book',
  people: 'People',
  laptop: 'Laptop',
  cloud: 'Cloud',
  terminal: 'Terminal',
  video: 'Video',
  comment: 'Chat',
};

export const COLOR_NAMES: Record<BrowserSpace['color'], string> = {
  accent: 'Accent',
  text: 'Ink',
  muted: 'Muted',
};

export function SpaceIcon({ icon }: { icon: BrowserSpace['icon'] }) {
  const Icon = ICONS[icon];
  return <Icon />;
}
