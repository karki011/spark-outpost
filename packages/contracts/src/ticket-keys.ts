import { z } from 'zod';
import { TICKET_KEY_MAX_LENGTH, type TicketSourceId } from './tickets.ts';

const keyShapes = {
  dashed: {
    exact: '[A-Za-z][A-Za-z0-9_]*-\\d+',
    inText: '[A-Z][A-Z0-9_]{1,9}-[1-9]\\d{0,6}',
    example: 'ENG-12',
  },
} as const;

type TicketKeyShape = keyof typeof keyShapes;

const ticketKeyShapeOf: Record<TicketSourceId, TicketKeyShape> = {
  linear: 'dashed',
  jira: 'dashed',
};

function shapesFor(source: TicketSourceId | undefined): TicketKeyShape[] {
  if (source) return [ticketKeyShapeOf[source]];
  return [...new Set(Object.values(ticketKeyShapeOf))];
}

function alternatives(parts: readonly string[]): string {
  return parts.length === 1 ? parts[0]! : `(?:${parts.join('|')})`;
}

export function ticketKeyPattern(source?: TicketSourceId): RegExp {
  return new RegExp(`^${alternatives(shapesFor(source).map((shape) => keyShapes[shape].exact))}$`);
}

export function ticketKeysInText(): RegExp {
  const keys = alternatives(shapesFor(undefined).map((shape) => keyShapes[shape].inText));
  return new RegExp(`(?<![\\w/.-])(${keys})(?![\\w-])`, 'g');
}

export function isTicketKey(key: string, source?: TicketSourceId): boolean {
  return ticketKeyPattern(source).test(key);
}

export function ticketKeyHint(source?: TicketSourceId): string {
  const examples = shapesFor(source).map((shape) => keyShapes[shape].example);
  return `Use a ticket key such as ${examples.join(' or ')}.`;
}

export function ticketKeySchemaFor(source?: TicketSourceId) {
  return z
    .string()
    .trim()
    .min(1)
    .max(TICKET_KEY_MAX_LENGTH)
    .regex(ticketKeyPattern(source), ticketKeyHint(source));
}

export const ticketKeySchema = ticketKeySchemaFor();
