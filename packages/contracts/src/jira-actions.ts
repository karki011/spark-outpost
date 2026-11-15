import { z } from 'zod';
import { ATLASSIAN_BODY_MAX } from './atlassian.ts';

export const ATLASSIAN_CARD_TEXT_MAX = 4_000;

const cardText = z.string().max(ATLASSIAN_CARD_TEXT_MAX);

export const JIRA_EDIT_OPS = [
  'update',
  'transition',
  'comment',
  'edit_comment',
  'delete_comment',
  'link',
  'unlink',
  'watch',
  'unwatch',
  'vote',
  'unvote',
  'log_work',
  'edit_worklog',
  'delete_worklog',
  'attach',
  'delete_attachment',
  'sprint',
  'backlog',
  'rank',
  'create_sprint',
  'start_sprint',
  'complete_sprint',
  'create_version',
  'release_version',
  'clone',
  'delete',
] as const;

export const jiraEditOpSchema = z.enum(JIRA_EDIT_OPS);
export type JiraEditOp = z.infer<typeof jiraEditOpSchema>;

export const jiraIssueFactsSchema = z.object({
  summary: z.string().max(1_000),
  description: cardText,
  labels: z.array(z.string().max(255)).max(50),
  priority: z.string().max(100).nullable(),
  parent: z.string().max(64).nullable().default(null),
  type: z.string().max(100).nullable().default(null),
  team: z.string().max(300).nullable().default(null),
});
export type JiraIssueFacts = z.infer<typeof jiraIssueFactsSchema>;

export const jiraTeamChoiceSchema = z.object({
  field: z.string().regex(/^customfield_\d{1,10}$/),
  id: z.string().min(1).max(100),
  name: z.string().max(300).nullable(),
});
export type JiraTeamChoice = z.infer<typeof jiraTeamChoiceSchema>;

export const jiraChangesSchema = z
  .object({
    summary: z.string().trim().min(1).max(255),
    description: z.string().max(ATLASSIAN_BODY_MAX),
    labels: z.array(z.string().trim().min(1).max(100)).max(50),
    priority: z.string().trim().min(1).max(100),
    parent: z.string().trim().min(1).max(64),
    issueType: z.string().trim().min(1).max(100),
    team: jiraTeamChoiceSchema,
  })
  .partial();
export type JiraChanges = z.infer<typeof jiraChangesSchema>;

export const jiraCardRowSchema = z.object({
  key: z.string().max(64).nullable().default(null),
  label: z.string().max(200),
  before: cardText.nullable(),
  after: cardText.nullable(),
});
export type JiraCardRow = z.infer<typeof jiraCardRowSchema>;

export const jiraTargetSchema = z.object({
  key: z.string().max(64),
  title: z.string().max(1_000),
  url: z.string().nullable(),
  updated: z.string().max(60).nullable(),
});
export type JiraTarget = z.infer<typeof jiraTargetSchema>;

export const jiraEditActionSchema = z.object({
  action: z.literal('jira_edit'),
  op: jiraEditOpSchema,
  ticket: z.object({
    key: z.string().max(64),
    title: z.string().max(1_000),
    url: z.string().nullable(),
  }),
  updated: z.string().max(60).nullable(),
  changes: jiraChangesSchema,
  before: jiraIssueFactsSchema.nullable(),
  after: jiraIssueFactsSchema.nullable(),
  comment: z
    .object({
      id: z.string().max(40),
      before: cardText,
      after: z.string().max(ATLASSIAN_BODY_MAX).nullable(),
      updatedAt: z.string().max(60).nullable(),
    })
    .nullable(),
  subtasks: z.array(z.string().max(64)).max(200),
  rows: z.array(jiraCardRowSchema).max(400).default([]),
  targets: z.array(jiraTargetSchema).max(50).default([]),
  plan: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type JiraEditAction = z.infer<typeof jiraEditActionSchema>;

const ask = (question: string, confirm: string) => ({ question, confirm });

export const JIRA_QUESTIONS: Record<JiraEditOp, { question: string; confirm: string }> = {
  update: ask('Change this ticket?', 'Save change'),
  transition: ask('Move this ticket?', 'Move ticket'),
  comment: ask('Post this comment on Jira?', 'Post comment'),
  edit_comment: ask('Edit this comment?', 'Save comment'),
  delete_comment: ask('Delete this comment?', 'Delete comment'),
  link: ask('Link these tickets?', 'Add link'),
  unlink: ask('Remove this link?', 'Remove link'),
  watch: ask('Add this watcher?', 'Add watcher'),
  unwatch: ask('Remove this watcher?', 'Remove watcher'),
  vote: ask('Vote for this ticket?', 'Vote'),
  unvote: ask('Remove your vote?', 'Remove vote'),
  log_work: ask('Log this work?', 'Log work'),
  edit_worklog: ask('Change this work log?', 'Save work log'),
  delete_worklog: ask('Delete this work log?', 'Delete work log'),
  attach: ask('Upload this file to Jira?', 'Upload file'),
  delete_attachment: ask('Delete this attachment?', 'Delete attachment'),
  sprint: ask('Move to this sprint?', 'Move to sprint'),
  backlog: ask('Move to the backlog?', 'Move to backlog'),
  rank: ask('Change the rank?', 'Rank'),
  create_sprint: ask('Create this sprint?', 'Create sprint'),
  start_sprint: ask('Start this sprint?', 'Start sprint'),
  complete_sprint: ask('Complete this sprint?', 'Complete sprint'),
  create_version: ask('Create this version?', 'Create version'),
  release_version: ask('Release this version?', 'Release version'),
  clone: ask('Clone this ticket?', 'Clone ticket'),
  delete: ask('Delete this ticket?', 'Delete ticket'),
};

const JIRA_DELETES: ReadonlySet<JiraEditOp> = new Set([
  'delete',
  'delete_comment',
  'unlink',
  'delete_worklog',
  'delete_attachment',
]);

export const isJiraDelete = (op: JiraEditOp) => JIRA_DELETES.has(op);
