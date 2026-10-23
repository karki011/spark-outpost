import { z } from 'zod';
import { serviceNowTableSchema } from './servicenow.ts';
import { TICKET_COMMENT_MAX_LENGTH } from './tickets.ts';

export const SERVICENOW_CARD_TEXT_MAX = 4_000;
export const SERVICENOW_QUERY_MAX = 2_000;
export const SERVICENOW_TITLE_MAX = 160;

const cardText = z.string().max(SERVICENOW_CARD_TEXT_MAX);
const noteText = z.string().max(TICKET_COMMENT_MAX_LENGTH);

export const serviceNowReadActionSchema = z.object({
  action: z.literal('servicenow_read'),
  what: z.string().max(300),
});
export type ServiceNowReadAction = z.infer<typeof serviceNowReadActionSchema>;

export const serviceNowEditOpSchema = z.enum(['update', 'work_note', 'comment', 'move']);
export type ServiceNowEditOp = z.infer<typeof serviceNowEditOpSchema>;

export const serviceNowLevelSchema = z.enum(['1', '2', '3']);

export const serviceNowChangesSchema = z
  .object({
    short_description: z.string().trim().min(1).max(SERVICENOW_TITLE_MAX),
    description: noteText,
    urgency: serviceNowLevelSchema,
    impact: serviceNowLevelSchema,
  })
  .partial();
export type ServiceNowChanges = z.infer<typeof serviceNowChangesSchema>;

const recordFactsSchema = z.object({
  shortDescription: z.string().max(1_000),
  description: cardText,
  urgency: z.string().max(100),
  impact: z.string().max(100),
});
export type ServiceNowRecordFacts = z.infer<typeof recordFactsSchema>;

const moveSchema = z.object({
  from: z.string().max(100),
  to: z.string().max(100),
  value: z.string().max(40),
  final: z.boolean(),
  closeCode: z.string().max(100).nullable(),
  closeNotes: noteText.nullable(),
});

export const serviceNowEditActionSchema = z.object({
  action: z.literal('servicenow_edit'),
  op: serviceNowEditOpSchema,
  record: z.object({
    table: serviceNowTableSchema,
    number: z.string().max(40),
    sysId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    title: z.string().max(1_000),
    url: z.string().max(2_000),
    caller: z.string().max(300).nullable(),
  }),
  updated: z.string().max(40),
  changes: serviceNowChangesSchema,
  before: recordFactsSchema.nullable(),
  after: recordFactsSchema.nullable(),
  note: noteText.nullable(),
  move: moveSchema.nullable(),
});
export type ServiceNowEditAction = z.infer<typeof serviceNowEditActionSchema>;

export type ServiceNowAction = ServiceNowReadAction | ServiceNowEditAction;

export const serviceNowActionSchemas = [
  serviceNowReadActionSchema,
  serviceNowEditActionSchema,
] as const;

export function isServiceNowAction(action: string): action is ServiceNowAction['action'] {
  return action === 'servicenow_read' || action === 'servicenow_edit';
}

export function serviceNowAsksAlways(action: { action: string }): boolean {
  if (action.action !== 'servicenow_edit') return false;
  const edit = action as ServiceNowEditAction;
  return edit.op === 'comment' || (edit.op === 'move' && edit.move?.final === true);
}

export function closingVerb(state: string): 'Resolve' | 'Cancel' | 'Close' {
  if (/^resolved$/i.test(state.trim())) return 'Resolve';
  if (/cancel/i.test(state)) return 'Cancel';
  return 'Close';
}

interface Answers {
  question: string;
  confirm: string;
  decline: string;
}

function editAnswers(action: ServiceNowEditAction): Answers {
  const number = action.record.number;
  if (action.op === 'update') {
    return { question: 'Change this record?', confirm: 'Save change', decline: 'Don’t' };
  }
  if (action.op === 'work_note') {
    return { question: 'Add a work note?', confirm: 'Add work note', decline: 'Don’t' };
  }
  if (action.op === 'comment') {
    return {
      question: 'Post a comment the caller sees?',
      confirm: 'Post comment',
      decline: 'Don’t post',
    };
  }
  if (action.move?.final) {
    const verb = closingVerb(action.move.to);
    return {
      question: `${verb} ${number}?`,
      confirm: verb,
      decline: `Don’t ${verb.toLowerCase()}`,
    };
  }
  return { question: 'Move this record?', confirm: 'Move', decline: 'Don’t' };
}

export function serviceNowQuestion(candidate: { action: string }): string | null {
  if (candidate.action === 'servicenow_read') return 'Let the agent read ServiceNow?';
  if (candidate.action !== 'servicenow_edit') return null;
  return editAnswers(candidate as ServiceNowEditAction).question;
}

export function serviceNowAnswers(action: ServiceNowAction): Answers {
  if (action.action === 'servicenow_read') {
    return {
      question: 'Let the agent read ServiceNow?',
      confirm: 'Allow for this chat',
      decline: 'Don’t',
    };
  }
  return editAnswers(action);
}

export const serviceNowActionLabels: Record<
  ServiceNowAction['action'],
  { question: string; confirm: string; doing: string }
> = {
  servicenow_read: {
    question: 'Let the agent read ServiceNow?',
    confirm: 'Allow for this chat',
    doing: 'Allowing ServiceNow…',
  },
  servicenow_edit: {
    question: 'Change this record?',
    confirm: 'Save change',
    doing: 'Changing ServiceNow…',
  },
};

export function serviceNowAuditFacts(action: ServiceNowAction): Record<string, unknown> {
  if (action.action === 'servicenow_read') return { action: action.action, what: action.what };
  return {
    action: action.action,
    op: action.op,
    table: action.record.table,
    number: action.record.number,
    changed: Object.keys(action.changes).toSorted(),
    ...(action.note === null ? {} : { noteLength: action.note.length }),
    ...(action.move
      ? {
          to: action.move.to,
          final: action.move.final,
          ...(action.move.closeCode ? { closeCode: action.move.closeCode } : {}),
          ...(action.move.closeNotes ? { closeNotesLength: action.move.closeNotes.length } : {}),
        }
      : {}),
  };
}
