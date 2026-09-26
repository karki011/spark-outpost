import './drag-card.css';
import { createPortal } from 'react-dom';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { ChevronIcon, FolderIcon } from '../ui/icons.tsx';
import type { SidebarDnd } from './use-sidebar-dnd.ts';

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const keyboardGlide = (event: Event | null) =>
  event instanceof KeyboardEvent ? `transform 200ms ${EASE_OUT}` : undefined;

const stillGlide = () => undefined;

const settle: DropAnimation = {
  duration: 200,
  easing: EASE_OUT,
  sideEffects: defaultDropAnimationSideEffects({
    className: { dragOverlay: 'landing' },
    styles: { active: { opacity: '0' } },
  }),
};

const bounce: DropAnimation = {
  ...settle,
  duration: 240,
  keyframes: ({ transform: { initial, final } }) => [
    { transform: CSS.Transform.toString(initial) },
    { transform: CSS.Transform.toString({ ...final, scaleX: 1.05, scaleY: 1.05 }), offset: 0.7 },
    { transform: CSS.Transform.toString(final) },
  ],
};

const fade: DropAnimation = {
  duration: 150,
  easing: EASE_OUT,
  sideEffects: null,
  keyframes: ({ transform: { initial } }) => [
    { opacity: 1, transform: CSS.Transform.toString(initial) },
    { opacity: 0, transform: CSS.Transform.toString(initial) },
  ],
};

interface ChatCardProps {
  chat: ConversationSummary;
  happy: boolean;
  moodKey: string;
}

function ChatCard({ chat, happy, moodKey }: ChatCardProps) {
  const classes = ['drag-card', chat.projectIds[0] ? 'in-project' : '', happy ? 'happy' : ''];
  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <span key={moodKey} className="dc-blob">
        <Blobatar
          name={`chat:${chat.id}`}
          size={16}
          animate="always"
          expression={happy ? expressions.happy : expressions.surprised}
          aria-hidden="true"
        />
      </span>
      <span className="dc-title">{chat.title}</span>
    </div>
  );
}

function ProjectCard({ project, count }: { project: Project; count: number }) {
  return (
    <div className="drag-card project">
      <ChevronIcon />
      <FolderIcon />
      <span className="dc-title">{project.name}</span>
      <span className="dc-count">{count || ''}</span>
    </div>
  );
}

interface SidebarDndProps {
  dnd: SidebarDnd;
  chat: ConversationSummary | null;
  project: { project: Project; count: number } | null;
  children: ReactNode;
}

export function SidebarDndContext({ dnd, chat, project, children }: SidebarDndProps) {
  const reduced = useReducedMotion();
  const dropAnimation = reduced ? fade : dnd.landed ? bounce : settle;
  return (
    <DndContext {...dnd.context}>
      {children}
      {createPortal(
        <DragOverlay
          className="drag-lift"
          modifiers={[restrictToWindowEdges]}
          dropAnimation={dropAnimation}
          transition={reduced ? stillGlide : keyboardGlide}
          zIndex={70}
        >
          {chat && <ChatCard chat={chat} happy={dnd.leftHome} moodKey={dnd.overGroup ?? 'home'} />}
          {project && <ProjectCard project={project.project} count={project.count} />}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
