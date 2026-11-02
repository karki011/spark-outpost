import type { OutpostStory } from '@spark-outpost/contracts';

export function startedThread(
  stories: readonly OutpostStory[],
  draftId: string | null | undefined,
): string | null {
  if (!draftId) return null;
  const story = stories.find((candidate) => candidate.draftId === draftId);
  const tasks = [...(story?.tasks ?? [])].sort((a, b) => a.position - b.position);
  return tasks.find((task) => task.openingPostId !== null)?.openingPostId ?? null;
}
