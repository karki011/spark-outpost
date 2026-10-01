import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import type { ScoutMood } from '../brand/BlobScout.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { UserBlob } from '../brand/UserBlob.tsx';
import { SIDEBAR_HINT, useSidebarLayout } from '../conversations/sidebar-layout.tsx';
import { UpdateBlob } from './UpdateBlob.tsx';
import './rail.css';

export type AppView = 'home' | 'chats' | 'analytics' | 'tickets' | 'map';

interface RailProps {
  view: AppView;
  waiting: number;
  ticketsWaiting: number;
  mood: ScoutMood;
  onView: (view: AppView) => void;
  onSettings: () => void;
  onProfile: () => void;
}

const ICON = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const VIEWS: { id: AppView; label: string; icon: ReactNode }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg {...ICON}>
        <path d="M3 11 12 4l9 7v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
  {
    id: 'chats',
    label: 'Chats',
    icon: (
      <svg {...ICON}>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
    ),
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: (
      <svg {...ICON}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    id: 'tickets',
    label: 'Tickets',
    icon: (
      <svg {...ICON}>
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
        <path d="M10 9v6" />
      </svg>
    ),
  },
  {
    id: 'map',
    label: 'Map',
    icon: (
      <svg {...ICON}>
        <path d="m5 18 5-9 7 3 2-7" />
        <circle cx="5" cy="18" r="1.8" fill="currentColor" />
        <circle cx="10" cy="9" r="1.8" fill="currentColor" />
        <circle cx="17" cy="12" r="2.2" fill="currentColor" />
        <circle cx="19" cy="5" r="1.4" fill="currentColor" />
      </svg>
    ),
  },
];

const MOOD_EXPRESSIONS: Record<NonNullable<ScoutMood>, BlobExpression> = {
  working: 'thinking',
  alert: 'unsure',
  happy: 'happy',
  sad: 'sad',
  sleep: 'sleepy',
};

function useIndicator(view: AppView) {
  const railRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const button = railRef.current?.querySelector<HTMLElement>(`[data-view="${view}"]`);
      if (button) setBox({ top: button.offsetTop, height: button.offsetHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [view]);
  return { railRef, box };
}

export function Rail({
  view,
  waiting,
  ticketsWaiting,
  mood,
  onView,
  onSettings,
  onProfile,
}: RailProps) {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const name = setup.data?.profile.displayName.trim() || 'You';
  const { railRef, box } = useIndicator(view);
  const layout = useSidebarLayout();
  const reopens = layout?.collapsed && !layout.narrow;

  return (
    <nav ref={railRef} className="rail" aria-label="Main">
      <button
        type="button"
        className="rail-logo"
        aria-label={`Your profile, ${name}`}
        title={name}
        onClick={onProfile}
      >
        <UserBlob
          displayName={name}
          size={40}
          expression={mood ? MOOD_EXPRESSIONS[mood] : 'idle'}
          animate="always"
        />
      </button>
      <span
        className="rail-ind"
        aria-hidden="true"
        style={box ? { transform: `translateY(${box.top}px)`, height: box.height } : { opacity: 0 }}
      />
      {VIEWS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="rail-btn"
          data-view={item.id}
          aria-current={view === item.id ? 'page' : undefined}
          title={
            item.id === 'chats' && reopens ? `Show chats sidebar (${SIDEBAR_HINT})` : undefined
          }
          onClick={() => onView(item.id)}
        >
          {item.icon}
          {item.label}
          {item.id === 'chats' && waiting > 0 && (
            <i
              className="rbadge"
              aria-label={`${waiting} ${waiting === 1 ? 'chat needs' : 'chats need'} your input`}
            >
              {waiting}
            </i>
          )}
          {item.id === 'tickets' && ticketsWaiting > 0 && (
            <i
              className="rbadge"
              aria-label={`${ticketsWaiting} ${ticketsWaiting === 1 ? 'ticket needs' : 'tickets need'} attention`}
            >
              {ticketsWaiting}
            </i>
          )}
        </button>
      ))}
      <span className="rail-sp" />
      <UpdateBlob />
      <button type="button" className="rail-btn" onClick={onSettings}>
        <svg {...ICON}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        Settings
      </button>
    </nav>
  );
}
