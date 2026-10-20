import type { InvolvementLevel } from '@spark-outpost/contracts';
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
  followUpRound?: boolean;
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
  if (facts.outpostStartTool) return [text.SPLIT_SUB_CHATS_START];
  return facts.outpostDraftTool ? [text.SPLIT_SUB_CHATS] : [];
}

function splitSection(facts: ChatPromptFacts): string {
  return [
    text.SPLIT_HEADING,
    text.SPLIT_ALONE,
    text.SPLIT_SUB_AGENTS,
    ...subChatLines(facts),
    text.SPLIT_UNCLEAR,
  ].join('\n');
}

function publishingLine(facts: ChatPromptFacts): string | null {
  const { project } = facts;
  if (!project) return null;
  const ownBranch = project.place === 'worktree' && project.branch !== null;
  const canPush = ownBranch && project.hasRemote && project.gitRepo !== false;
  if (facts.followUpRound && canPush) return text.PUBLISH_FOLLOW_UP;
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
