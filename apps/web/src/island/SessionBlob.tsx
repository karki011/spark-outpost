import '../terminal/native-terminal.css';
import { useReducedMotion } from 'motion/react';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { seedIndex } from './seed-index.ts';
import type { SessionState } from './island-model.ts';
import { sessionColor, sessionExpression } from './island-mood.ts';

interface SessionBlobProps {
  chat: ConversationSummary;
  state: SessionState;
  size: number;
  expression?: BlobExpression;
  live?: boolean;
}

export function sessionSeed(chat: ConversationSummary): string {
  if (chat.sessionType === 'terminal') return `terminal:${chat.id}`;
  return `chat:${chat.title.trim().toLowerCase() || chat.id}`;
}

export function sessionTint(chat: ConversationSummary): string {
  const seed = sessionSeed(chat);
  return sessionColor((count) => seedIndex(seed, count));
}

export function SessionBlob({ chat, state, size, expression, live = false }: SessionBlobProps) {
  const seed = sessionSeed(chat);
  const reduced = useReducedMotion();
  return (
    <span
      className="isl-sblob"
      data-state={state}
      data-terminal={chat.sessionType === 'terminal' ? 'true' : undefined}
      style={{
        ['--sc' as string]: sessionTint(chat),
        width: size,
        height: size,
      }}
      aria-hidden="true"
    >
      {reduced ? (
        <Blobatar
          name={seed}
          size={size}
          expression={expressions[expression ?? sessionExpression(state, false)]}
        />
      ) : (
        <Blobatar
          name={seed}
          size={size}
          animate={live ? 'always' : 'hover'}
          expression={expressions[expression ?? sessionExpression(state, false)]}
        />
      )}
      {chat.sessionType === 'terminal' && <span className="isl-terminal-mark">&gt;_</span>}
    </span>
  );
}
