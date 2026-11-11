import type { ConversationSummary, RunStatus } from '@spark-outpost/contracts';
import { isTerminalRunStatus } from '@spark-outpost/contracts';
import { areaForPath } from './map-model.ts';
import { fileKey, type Scene } from './scene.ts';

export interface RunningChat {
  id: string;
  title: string;
  status: RunStatus;
  projectId: string;
  paths: readonly string[];
}

export interface RunningMarks {
  changed: Set<number>;
  areas: Map<string, number>;
  perChat: { id: string; files: number }[];
}

export const NO_MARKS: RunningMarks = { changed: new Set(), areas: new Map(), perChat: [] };

export function activeChatsIn(
  chats: readonly ConversationSummary[],
  projectIds: readonly string[],
): ConversationSummary[] {
  return chats.filter(
    (chat) =>
      !chat.archivedAt &&
      chat.latestRun !== null &&
      !isTerminalRunStatus(chat.latestRun.status) &&
      chat.projectIds.some((id) => projectIds.includes(id)),
  );
}

export function runningMarks(
  scene: Scene,
  chats: readonly RunningChat[],
  focused: string | null,
): RunningMarks {
  const changed = new Set<number>();
  const areas = new Map<string, number>();
  const perChat: { id: string; files: number }[] = [];
  for (const chat of chats) {
    perChat.push({ id: chat.id, files: chat.paths.length });
    if (focused !== null && chat.id !== focused) continue;
    for (const path of chat.paths) {
      const file = scene.fileByKey.get(fileKey(chat.projectId, path));
      if (file !== undefined) changed.add(file);
      const area = areaForPath(scene, chat.projectId, path);
      if (area) areas.set(area, (areas.get(area) ?? 0) + 1);
    }
  }
  return { changed, areas, perChat };
}

export function wantedPaths(
  chats: readonly RunningChat[],
  focused: string | null,
): { projectId: string; paths: string[] } | null {
  const lead = chats.find((chat) => chat.id === focused) ?? chats[0];
  if (!lead) return null;
  const paths = chats
    .filter(
      (chat) => chat.projectId === lead.projectId && (focused === null || chat.id === focused),
    )
    .flatMap((chat) => chat.paths);
  return { projectId: lead.projectId, paths };
}
