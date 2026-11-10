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
  outpostDraftTool: boolean;
  outpostStartTool?: boolean;
  level: InvolvementLevel;
  asksWithTool?: boolean;
  assignedWork?: boolean;
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

function subChatLines(facts: ChatPromptFacts): string[] {
  if (facts.assignedWork) return [];
  if (facts.outpostStartTool) return [text.SPLIT_SUB_CHATS_START];
  return facts.outpostDraftTool ? [text.SPLIT_SUB_CHATS] : [];
}

function splitSection(facts: ChatPromptFacts): string {
  return [
    text.SPLIT_HEADING,
    delegationPolicy({ assignedWork: facts.assignedWork === true }),
    ...subChatLines(facts),
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
  requestAssigned: boolean;
}

export function chatTurnNote(facts: ChatTurnFacts): string | null {
  const lines: string[] = [];
  if (facts.requestAssigned) {
    lines.push(text.TURN_NOTE_ASSIGNED, ASSIGNED_WORK_LINE, text.TURN_NOTE_NO_SUB_CHATS);
  }
  if (facts.followUpRound && facts.project && canPushTo(facts.project)) {
    lines.push(text.TURN_NOTE_PUBLISHING, `- ${text.PUBLISH_FOLLOW_UP}`);
  }
  return lines.length === 0 ? null : [text.TURN_NOTE_INTRO, ...lines].join('\n');
}
