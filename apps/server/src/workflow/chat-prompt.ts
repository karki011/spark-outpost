import type { InvolvementLevel } from '@spark-outpost/contracts';
import { ASSIGNED_WORK_LINE, delegationPolicy } from '../agents/delegation-policy.ts';
import * as text from './chat-prompt-text.ts';

export interface ChatPromptProject {
  folder: string;
  branch: string | null;
  repo: string | null;
  place: 'worktree' | 'checkout';
  linkedRepos: readonly string[];
  hasRemote: boolean;
  gitRepo?: boolean;
}

export interface ChatPromptFacts {
  project: ChatPromptProject | null;
  subChatsTool?: boolean;
  level: InvolvementLevel;
  asksWithTool?: boolean;
  builderChat?: { spark: { id: string; name: string } | null };
  customInstructions: string | null;
}

function placeNote(project: ChatPromptProject): string {
  const kind = project.place === 'worktree' ? 'a worktree' : "the user's checkout";
  const repo = project.repo === null ? '' : text.oneLine(project.repo);
  return repo ? `${kind} of ${repo}` : kind;
}

function whereLines(project: ChatPromptProject): string[] {
  const folder = `Folder: ${text.oneLine(project.folder)}`;
  const branch = project.branch === null ? '' : text.oneLine(project.branch);
  const lines = [branch ? `${folder} · Branch: ${branch} (${placeNote(project)})` : folder];
  const linked = project.linkedRepos.map(text.oneLine).filter(Boolean);
  if (linked.length > 0) lines.push(`Linked repos: ${linked.join(', ')}`);
  return lines;
}

function splitSection(facts: ChatPromptFacts): string {
  return [
    text.SPLIT_HEADING,
    delegationPolicy(),
    ...(facts.subChatsTool ? [text.SPLIT_SUB_CHATS_TOOL] : []),
    facts.asksWithTool ? text.SPLIT_ASK_WITH_TOOL : text.SPLIT_UNCLEAR,
  ].join('\n');
}

function ownBranchOf(project: ChatPromptProject): boolean {
  return project.place === 'worktree' && project.branch !== null;
}

function canPushTo(project: ChatPromptProject): boolean {
  return ownBranchOf(project) && project.hasRemote && project.gitRepo !== false;
}

function publishingLine(facts: ChatPromptFacts): string | null {
  const { project } = facts;
  if (!project) return null;
  const ownBranch = ownBranchOf(project);
  if (facts.level === 'hands-off') return text.PUBLISH_NOT_ASKED;
  if (project.gitRepo === false) return text.PUBLISH_NOT_GIT;
  if (project.place === 'checkout') return text.PUBLISH_CHECKOUT;
  if (!ownBranch) return null;
  return project.hasRemote ? text.PUBLISH_FULL_AUTO : text.PUBLISH_NO_REMOTE;
}

export function chatPrompt(facts: ChatPromptFacts): string {
  const where = facts.project ? whereLines(facts.project) : [];
  const sections = [
    [text.INTRO, ...where].join('\n'),
    ...(facts.builderChat ? [text.builderNote(facts.builderChat.spark)] : []),
    splitSection(facts),
    text.ENGINEERING,
    text.REPORTING,
  ];
  const publishing = publishingLine(facts);
  if (publishing) sections.push(`${text.PUBLISHING_HEADING}\n- ${publishing}`);
  const custom = facts.customInstructions;
  if (custom !== null && custom.trim() !== '') {
    sections.push(`${text.SETTINGS_HEADING}\n${custom}`);
  }
  return sections.join('\n\n');
}

export interface ChatTurnFacts {
  project: ChatPromptProject | null;
  followUpRound: boolean;
  taskTurn: boolean;
  roundRunning?: { number: number; round: number; doing: string } | null;
  workflowRunning?: string | null;
}

export function chatTurnNote(facts: ChatTurnFacts): string | null {
  const lines: string[] = [];
  if (facts.taskTurn) {
    lines.push(text.TURN_NOTE_ASSIGNED, ASSIGNED_WORK_LINE, text.TURN_NOTE_NO_SUB_CHATS);
  }
  if (facts.followUpRound && facts.project && canPushTo(facts.project)) {
    lines.push(text.TURN_NOTE_PUBLISHING, `- ${text.PUBLISH_FOLLOW_UP}`);
  }
  if (facts.roundRunning) lines.push(text.roundRunningNote(facts.roundRunning));
  if (facts.workflowRunning) lines.push(text.workflowRunningNote(facts.workflowRunning));
  return lines.length === 0 ? null : [text.TURN_NOTE_INTRO, ...lines].join('\n');
}
