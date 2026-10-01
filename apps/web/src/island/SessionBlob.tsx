import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { seedIndex } from './crew-voice.ts';
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
  return `chat:${chat.title.trim().toLowerCase() || chat.id}`;
}

export function SessionBlob({ chat, state, size, expression, live = false }: SessionBlobProps) {
  const seed = sessionSeed(chat);
  return (
    <span
      className="isl-sblob"
      data-state={state}
      style={{
        ['--sc' as string]: sessionColor((count) => seedIndex(seed, count)),
        width: size,
        height: size,
      }}
      aria-hidden="true"
    >
      <Blobatar
        name={seed}
        size={size}
        animate={live ? 'always' : 'hover'}
        expression={expressions[expression ?? sessionExpression(state, false)]}
      />
    </span>
  );
}
