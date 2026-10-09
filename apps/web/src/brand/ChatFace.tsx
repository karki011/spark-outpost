import './chat-face.css';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import { colorHue, shapeTrait } from '../teammates/face-style.ts';
import { useReducedMotion } from '../ui/motion.ts';
import { chatFace, chatFaceSeed, isLive, type ChatFaceState } from './chat-face.ts';

const DRAWN = { row: 22, post: 24, strip: 32 } as const;
type ChatFaceSize = keyof typeof DRAWN;

const TONE = 0.5;

export function chatBlob(chatId: string) {
  const look = chatFace(chatId, 'idle');
  return {
    name: chatFaceSeed(chatId),
    hue: colorHue(look.color),
    tone: TONE,
    traits: { shape: shapeTrait(look.shape) },
  };
}

interface ChatFaceProps {
  chatId: string;
  size: ChatFaceSize;
  state?: ChatFaceState;
  label?: string | undefined;
}

export function ChatFace({ chatId, size, state = 'idle', label }: ChatFaceProps) {
  const reduced = useReducedMotion();
  const look = chatFace(chatId, state);
  const blob = { ...chatBlob(chatId), size: DRAWN[size], expression: expressions[look.expression] };
  const naming = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <span
      className="chat-face"
      data-size={size}
      data-color={look.color}
      data-shape={look.shape}
      data-expression={look.expression}
      {...naming}
    >
      {isLive(state) && !reduced ? (
        <Blobatar {...blob} animate="always" aria-hidden="true" />
      ) : (
        <Blobatar {...blob} alt="" />
      )}
    </span>
  );
}
