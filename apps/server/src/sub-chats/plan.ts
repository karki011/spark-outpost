import {
  aboveParentMode,
  cappedMode,
  defaultModeFor,
  modeKind,
  modePosture,
  type InvolvementLevel,
  type ModePosture,
  type PlannedSubChat,
  type ProviderCapabilities,
  type ProviderId,
  type SubChatPiece,
} from '@spark-outpost/contracts';
import { firstReportedEffort } from '../providers/efforts.ts';
import { proposedAboveOwnMode } from './mode-cap.ts';
import { proposedModeId, unknownProposedMode, type ModeChoice } from './proposed-mode.ts';

export interface PlanProject {
  id: string;
  name: string;
  folderExists: boolean;
}

export interface PlanAgent {
  id: ProviderId;
  name: string;
  models: readonly { id: string; label: string }[];
  efforts: readonly string[];
  modes: readonly ModeChoice[];
  capabilities: ProviderCapabilities | undefined;
}

export interface PlanParent {
  projectId: string;
  provider: ProviderId;
  model: string | null;
  effort: string | null;
  agentMode: string | null;
  level: InvolvementLevel | null;
  posture: ModePosture;
}

export interface PlanFacts {
  parent: PlanParent;
  projects: readonly PlanProject[];
  agents: readonly PlanAgent[];
  existingTitles: readonly string[];
  newId: () => string;
}

export type SubChatPlan =
  { kind: 'plan'; pieces: PlannedSubChat[] } | { kind: 'refusal'; message: string };

class PlanRefusal extends Error {}

export function quoted(title: string): string {
  return `“${title}”`;
}

export function folderMissing(project: string): string {
  return `The folder for ${project} is missing. Restore it or choose another project.`;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function listed(names: readonly string[]): string {
  return names.join(', ') || 'none';
}

function refuseDuplicateTitles(pieces: readonly SubChatPiece[], existing: readonly string[]) {
  const seen: string[] = [];
  for (const { title } of pieces) {
    if (seen.some((other) => sameText(other, title))) {
      throw new PlanRefusal(`${quoted(title)} is used by more than one piece. Give each a title.`);
    }
    if (existing.some((other) => sameText(other, title))) {
      throw new PlanRefusal(
        `This chat already has a sub-chat called ${quoted(title)}. Choose another title.`,
      );
    }
    seen.push(title);
  }
}

function pieceNamed(pieces: readonly SubChatPiece[], title: string): number {
  return pieces.findIndex((piece) => sameText(piece.title, title));
}

function waitsOn(pieces: readonly SubChatPiece[], piece: SubChatPiece): number[] {
  const named = [...(piece.stackedOn ? [piece.stackedOn] : []), ...piece.startsAfter];
  return named.map((title) => {
    const index = pieceNamed(pieces, title);
    if (index === -1) {
      throw new PlanRefusal(
        `${quoted(piece.title)} waits for ${quoted(title)}, which is not a piece in this call.`,
      );
    }
    if (pieces[index] === piece) {
      throw new PlanRefusal(`${quoted(piece.title)} cannot wait for itself.`);
    }
    return index;
  });
}

function refuseCycles(pieces: readonly SubChatPiece[], waits: readonly number[][]): void {
  const done = new Set<number>();
  const visit = (index: number, path: readonly number[]): void => {
    if (path.includes(index)) {
      const loop = [...path.slice(path.indexOf(index)), index];
      const names = loop.map((at) => quoted(pieces[at]!.title)).join(' → ');
      throw new PlanRefusal(
        `These pieces wait for each other: ${names}. Remove one stackedOn or startsAfter.`,
      );
    }
    if (done.has(index)) return;
    for (const next of waits[index] ?? []) visit(next, [...path, index]);
    done.add(index);
  };
  pieces.forEach((_piece, index) => visit(index, []));
}

function projectOf(facts: PlanFacts, piece: SubChatPiece): PlanProject {
  const wanted = piece.project;
  const found = facts.projects.find((project) =>
    wanted === undefined
      ? project.id === facts.parent.projectId
      : project.id === wanted.toLowerCase() || sameText(project.name, wanted),
  );
  if (!found) {
    const names = listed(facts.projects.map((project) => project.name));
    throw new PlanRefusal(
      wanted === undefined
        ? 'This chat’s project no longer exists, so name a project for each piece.'
        : `${quoted(piece.title)}: no project called ${wanted}. Projects: ${names}.`,
    );
  }
  if (!found.folderExists) throw new PlanRefusal(folderMissing(found.name));
  return found;
}

function agentOf(facts: PlanFacts, piece: SubChatPiece): PlanAgent {
  const wanted = piece.agent ?? facts.parent.provider;
  const found = facts.agents.find(
    (agent) => agent.id === wanted.toLowerCase() || sameText(agent.name, wanted),
  );
  if (found) return found;
  const names = listed(facts.agents.map((agent) => agent.id));
  throw new PlanRefusal(
    `${quoted(piece.title)}: ${wanted} is not a connected agent. Agents: ${names}.`,
  );
}

function modelOf(parent: PlanParent, agent: PlanAgent, piece: SubChatPiece): string | null {
  const wanted = piece.model;
  if (wanted === undefined) return agent.id === parent.provider ? parent.model : null;
  if (agent.models.length === 0) return wanted;
  const found = agent.models.find((model) => model.id === wanted || sameText(model.label, wanted));
  if (found) return found.id;
  const names = listed(agent.models.map((model) => model.id));
  throw new PlanRefusal(
    `${quoted(piece.title)}: ${agent.name} has no model called ${wanted}. Models: ${names}.`,
  );
}

function effortOf(parent: PlanParent, agent: PlanAgent, piece: SubChatPiece): string | null {
  const wanted = piece.effort;
  if (wanted === undefined) {
    if (parent.effort === null) return null;
    return firstReportedEffort([parent.effort, agent.efforts[0]], agent.efforts);
  }
  const found = firstReportedEffort([wanted.toLowerCase()], agent.efforts);
  if (found) return found;
  throw new PlanRefusal(
    `${quoted(piece.title)}: ${agent.name} has no effort called ${wanted}. Efforts: ${listed(agent.efforts)}.`,
  );
}

function postureOf(agent: PlanAgent, mode: string | null): ModePosture {
  const effective = mode ?? agent.capabilities?.defaultMode ?? defaultModeFor(agent.id);
  return modePosture(agent.id, effective, modeKind(agent.capabilities?.modes ?? [], effective));
}

function proposedMode(agent: PlanAgent, piece: SubChatPiece, wanted: string): string {
  if (agent.modes.length === 0) return wanted;
  const found = proposedModeId(agent.modes, wanted);
  if (found) return found;
  throw new PlanRefusal(unknownProposedMode(quoted(piece.title), wanted, agent.modes));
}

function modeOf(parent: PlanParent, agent: PlanAgent, piece: SubChatPiece): string | null {
  if (piece.mode !== undefined) {
    const mode = proposedMode(agent, piece, piece.mode);
    if (aboveParentMode(parent.posture, postureOf(agent, mode))) {
      throw new PlanRefusal(proposedAboveOwnMode(quoted(piece.title)));
    }
    return mode;
  }
  const inherited = agent.id === parent.provider ? parent.agentMode : null;
  const mode = cappedMode(agent.id, inherited, agent.capabilities, parent.posture);
  if (aboveParentMode(parent.posture, postureOf(agent, mode))) {
    throw new PlanRefusal(
      `${quoted(piece.title)}: ${agent.name} has no mode that asks at least as often as this chat’s. Use this chat’s agent for it.`,
    );
  }
  return mode;
}

function inheritsAll(piece: SubChatPiece): boolean {
  return piece.agent === undefined && piece.model === undefined && piece.effort === undefined;
}

function planned(facts: PlanFacts, pieces: readonly SubChatPiece[]): PlannedSubChat[] {
  refuseDuplicateTitles(pieces, facts.existingTitles);
  const waits = pieces.map((piece) => waitsOn(pieces, piece));
  refuseCycles(pieces, waits);
  const ids = pieces.map(() => facts.newId());
  const projects = pieces.map((piece) => projectOf(facts, piece));
  return pieces.map((piece, index) => {
    const project = projects[index]!;
    const agent = agentOf(facts, piece);
    const stackedOn = piece.stackedOn ? pieceNamed(pieces, piece.stackedOn) : -1;
    if (stackedOn !== -1 && projects[stackedOn]!.id !== project.id) {
      throw new PlanRefusal(
        `${quoted(piece.title)} can be stacked on ${quoted(pieces[stackedOn]!.title)} only in the same repository. Use startsAfter for order alone.`,
      );
    }
    const after = piece.startsAfter.map((title) => pieceNamed(pieces, title));
    return {
      conversationId: ids[index]!,
      title: piece.title,
      task: piece.task,
      project: { id: project.id, name: project.name },
      provider: agent.id,
      agentName: agent.name,
      model: modelOf(facts.parent, agent, piece),
      effort: effortOf(facts.parent, agent, piece),
      agentMode: modeOf(facts.parent, agent, piece),
      level: piece.autonomy ?? facts.parent.level,
      sameAsParent: inheritsAll(piece),
      stackedOn: stackedOn === -1 ? null : ids[stackedOn]!,
      startsAfter: [...new Set(after.filter((at) => at !== stackedOn))].map((at) => ids[at]!),
    };
  });
}

export function planSubChats(pieces: readonly SubChatPiece[], facts: PlanFacts): SubChatPlan {
  try {
    return { kind: 'plan', pieces: planned(facts, pieces) };
  } catch (error) {
    if (error instanceof PlanRefusal) return { kind: 'refusal', message: error.message };
    throw error;
  }
}

export type StartChoices = Pick<PlannedSubChat, 'model' | 'effort'> | { problem: string };

export function startChoices(piece: PlannedSubChat, agent: PlanAgent | undefined): StartChoices {
  if (!agent) return { problem: `${piece.agentName || piece.provider} is no longer connected.` };
  const { model } = piece;
  const offered = agent.models.length === 0 || agent.models.some(({ id }) => id === model);
  if (model !== null && !offered) {
    return { problem: `${agent.name} has no model called ${model}.` };
  }
  const effort =
    piece.effort === null
      ? null
      : firstReportedEffort([piece.effort, agent.efforts[0]], agent.efforts);
  return { model, effort };
}
